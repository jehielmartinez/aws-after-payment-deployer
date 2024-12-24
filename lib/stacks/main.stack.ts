import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import { Construct } from 'constructs';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Queue } from 'aws-cdk-lib/aws-sqs';

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table to store the information and status of the clients
    const clientsTable = new Table(this, 'clients', {
      tableName: 'clients',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      readCapacity: 1,
      writeCapacity: 1,
      partitionKey: { name: 'id', type: AttributeType.STRING },
      sortKey: { name: 'email', type: AttributeType.STRING },
    });

    // Dead letter queue to store the messages that failed to be processed, it must be reviewed manually
    const dlq = new Queue(this, 'deadLetterQueue', {
      queueName: 'DeadLetterQueue',
      retentionPeriod: cdk.Duration.days(14),
    });

    // FIFO (First-In-First-Out) queue to send the messages from the webhook to the deployer
    const fifoQueue = new Queue(this, 'fifoQueue', {
      queueName: 'Queue.fifo',
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
      fifo: true,
      contentBasedDeduplication: true,
    });

    // Lambda function to be used a webhook, it will receive the confirmation from the payment service
    const webhook = new NodejsFunction(this, 'webhook', {
      runtime: Runtime.NODEJS_LATEST,
      entry: path.join(__dirname, '../lambdas/webhook.ts'),
      functionName: 'webhook',
      handler: 'handler',
      environment: {
        CLIENTS_TABLE: clientsTable.tableName,
        FIFO_QUEUE: fifoQueue.queueUrl,
      },
    });
    fifoQueue.grantSendMessages(webhook);
    clientsTable.grantReadWriteData(webhook);
    const webhookUrl = webhook.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
      }
    });

    // Lambda function to deploy the infrastructure for the client
    const deployer = new NodejsFunction(this, 'deployer', {
      runtime: Runtime.NODEJS_LATEST,
      entry: path.join(__dirname, '../lambdas/deployer.ts'),
      functionName: 'deployer',
      handler: 'handler',
      environment: {
        CLIENTS_TABLE: clientsTable.tableName,
        FIFO_QUEUE: fifoQueue.queueUrl,
        TEMPLATE_URL: 'https://s3.amazonaws.com/your-bucket/template.yml',
      },
    });
    deployer.addEventSource(new SqsEventSource(fifoQueue));
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
