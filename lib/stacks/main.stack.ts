import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import { Construct } from 'constructs';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { FunctionUrlAuthType, HttpMethod, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Queue } from 'aws-cdk-lib/aws-sqs';

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table to store the information and status of the clients
    const clientsTable = new Table(this, 'ClientsTable', {
      tableName: 'clients',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      readCapacity: 1,
      writeCapacity: 1,
      partitionKey: { name: 'id', type: AttributeType.STRING },
      sortKey: { name: 'email', type: AttributeType.STRING },
    });

    // Dead letter queue to store the messages that failed to be processed, it must be reviewed manually
    const dlq = new Queue(this, 'DeadLetterQueue', {
      queueName: 'DeadLetterQueue.fifo',
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    // FIFO (First-In-First-Out) queue to send the messages from the webhook to the deployer
    const fifoQueue = new Queue(this, 'FifoQueue', {
      queueName: 'Queue.fifo',
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.minutes(5), // Wait 5 minutes between batches
    });

    // Lambda function to be used a webhook, it will receive the confirmation from the payment service
    const webhook = new NodejsFunction(this, 'WebhookLambda', {
      runtime: Runtime.NODEJS_LATEST,
      entry: path.join(__dirname, '../lambdas/webhook.ts'),
      functionName: 'webhook',
      handler: 'handler',
      environment: {
        CLIENTS_TABLE: clientsTable.tableName,
        FIFO_QUEUE: fifoQueue.queueUrl,
      },
    });

    // Grant permissions to the webhook function
    fifoQueue.grantSendMessages(webhook);
    clientsTable.grantReadWriteData(webhook);
    const webhookUrl = webhook.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [HttpMethod.POST],
      }
    });

    // Lambda function to deploy the infrastructure for the client
    const deployer = new NodejsFunction(this, 'DeployerLambda', {
      runtime: Runtime.NODEJS_LATEST,
      entry: path.join(__dirname, '../lambdas/deployer.ts'),
      functionName: 'deployer',
      handler: 'handler',
      environment: {
        CLIENTS_TABLE: clientsTable.tableName,
        FIFO_QUEUE: fifoQueue.queueUrl,
        TEMPLATE_URL: 'https://s3.amazonaws.com/cf-templates-REGION/template.yaml',
      },
    });
    deployer.addEventSource(new SqsEventSource(fifoQueue, {
      batchSize: 1, // Process only one message at a time
      maxConcurrency: 5, // Concurrent CloudFormation stacks ON_CREATE operations is 5 
      reportBatchItemFailures: true, // Ensure failed messages are reported
    }));

    // Grant permissions to the deployer function
    fifoQueue.grantConsumeMessages(deployer);
    clientsTable.grantReadWriteData(deployer);
    deployer.role?.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')
    );

    new cdk.CfnOutput(this, 'webhookUrl', {
      value: webhookUrl.url,
      description: 'Webhook URL',
    });
  }
}
