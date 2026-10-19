import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Code, Function as LambdaFunction, FunctionUrlAuthType, HttpMethod, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";

const BUNDLE = fileURLToPath(new URL("../../packages/server/dist-lambda/", import.meta.url));
const EXECUTOR_NAME = "offpeak-executor";

/**
 * Off-Peak on AWS: MCP server (Express) on Lambda behind the AWS Lambda Web Adapter with a Function URL,
 * DynamoDB single-table store, EventBridge Scheduler one-time schedules → executor Lambda.
 * Demos run locally with the sim clock; this stack uses the real clock.
 */
export class OffPeakStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const ctx = (k: string) => String(this.node.tryGetContext(k) ?? "");

    const table = new Table(this, "Table", {
      tableName: "OffPeak",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const code = Code.fromAsset(BUNDLE);
    // Built by name (not by reference) so the executor can schedule without a circular dependency.
    const executorArn = `arn:${this.partition}:lambda:${this.region}:${this.account}:function:${EXECUTOR_NAME}`;

    const schedulerRole = new Role(this, "SchedulerRole", {
      assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
      description: "Lets EventBridge Scheduler invoke the Off-Peak executor",
    });
    schedulerRole.addToPolicy(new PolicyStatement({ actions: ["lambda:InvokeFunction"], resources: [executorArn] }));

    const common = {
      STORE: "dynamodb",
      DDB_TABLE: table.tableName,
      HOUSEHOLD_TZ: ctx("householdTz"),
      CLOCK: "real",
      SCHEDULER: "eventbridge",
      EXECUTOR_LAMBDA_ARN: executorArn,
      SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
      FIXTURES_DIR: "/var/task/fixtures",
      PLAN_APP_HTML: "/var/task/plan.html",
      LLM_MODE: ctx("llmMode") || "mock",
      ...(ctx("bedrockModelId") ? { BEDROCK_MODEL_ID: ctx("bedrockModelId") } : {}),
    };

    const executor = new LambdaFunction(this, "Executor", {
      functionName: EXECUTOR_NAME,
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.X86_64,
      code,
      handler: "executor.handler",
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: common,
      description: "Runs one scheduled Off-Peak job (fired by EventBridge Scheduler)",
    });

    // AWS Lambda Web Adapter runs the unmodified Express server (see github.com/awslabs/aws-lambda-web-adapter).
    const adapter = LayerVersion.fromLayerVersionArn(
      this,
      "WebAdapter",
      `arn:${this.partition}:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerX86:${ctx("lambdaWebAdapterLayerVersion")}`,
    );
    const server = new LambdaFunction(this, "McpServer", {
      functionName: "offpeak-mcp",
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.X86_64,
      code,
      handler: "run.sh",
      layers: [adapter],
      memorySize: 1024,
      timeout: Duration.seconds(30),
      environment: {
        ...common,
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        AWS_LWA_PORT: "8080",
        PORT: "8080",
        WEB_ORIGIN: ctx("webOrigin"),
        SIM_ADMIN: "0",
      },
      description: "Off-Peak MCP server (Streamable HTTP, protocol 2025-11-25)",
    });

    for (const fn of [server, executor]) table.grantReadWriteData(fn);
    server.addToRolePolicy(new PolicyStatement({ actions: ["scheduler:CreateSchedule", "scheduler:DeleteSchedule"], resources: ["*"] }));
    server.addToRolePolicy(new PolicyStatement({ actions: ["iam:PassRole"], resources: [schedulerRole.roleArn] }));
    server.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "polly:SynthesizeSpeech"],
        resources: ["*"],
      }),
    );

    const url = server.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [ctx("webOrigin")],
        allowedMethods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE],
        allowedHeaders: ["content-type", "accept", "mcp-protocol-version", "mcp-session-id", "authorization"],
        exposedHeaders: ["mcp-session-id"],
      },
    });

    new CfnOutput(this, "McpUrl", { value: `${url.url}mcp`, description: "Point VITE_MCP_URL / the MCP Inspector here" });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "ExecutorArn", { value: executor.functionArn });
  }
}
