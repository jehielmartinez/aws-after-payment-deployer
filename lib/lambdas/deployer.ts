import { SQSEvent, Handler} from "aws-lambda";
import { SQS, DynamoDB, CloudFormation } from "aws-sdk";
import { Client } from "./webhook";

const sqsClient = new SQS();
const dynamoDbClient = new DynamoDB();
const cloudformation = new CloudFormation();
const tableName = process.env.CLIENTS_TABLE;
const fifoQueueUrl = process.env.FIFO_QUEUE;
const templateUrl = process.env.TEMPLATE_URL;

const deployStack = (client: Client) => {
  const stackName = `client-${client.id}`;
  return cloudformation.createStack({
    StackName: stackName,
    TemplateURL: templateUrl,
    Parameters: [
      {
        ParameterKey: 'clientId',
        ParameterValue: client.id,
      },
    ],
    Capabilities: ['CAPABILITY_IAM'],
  }).promise();
}

const updateClientStatus = async (client: Client) => { 
  await dynamoDbClient.updateItem({
    TableName: tableName ?? '',
    Key: {
      id: { S: client.id },
      email: { S: client.email },
    },
    UpdateExpression: 'SET #status = :status',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': { S: 'DEPLOYING' },
    },
  }).promise();
}

const deleteMessage = async (receiptHandle: string) => {
  await sqsClient.deleteMessage({
    QueueUrl: fifoQueueUrl ?? '',
    ReceiptHandle: receiptHandle,
  }).promise();
}

export const handler: Handler<SQSEvent> = async (event) => {
  const records = event.Records;
  // Process only one message from the fifo queue
  const record = records[0];
  try {
    const client = JSON.parse(record.body) as Client;
    await deployStack(client);
    await updateClientStatus(client);
    await deleteMessage(record.receiptHandle);
    console.log(`Client ${client.id} is being deployed`);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }





 


}