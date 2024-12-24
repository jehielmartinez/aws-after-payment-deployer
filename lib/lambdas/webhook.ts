import { Handler } from "aws-cdk-lib/aws-lambda";
import { SQS, DynamoDB } from "aws-sdk";

const sqsClient = new SQS();
const dynamoDbClient = new DynamoDB();
const fifoQueueUrl = process.env.FIFO_QUEUE;
const tableName = process.env.CLIENTS_TABLE;

// Based on Stripe's webhook event object
interface EventBody {
  type: string;
  data: {
    object: {
      customer: string;
      customer_name: string;
      customer_email: string;
    }
  }
}

export interface Client {
  id: string;
  name: string;
  email: string;
  createdAt?: string;
  status?: string;
}

const isPaymentConfirmed = (event: any): boolean => {
  const body = JSON.parse(event.body) as EventBody;
  if (body.type === 'invoice.payment_succeeded') {
    return true;
  }
  return false;
}

const createClient = (body: EventBody): Client => {
  return {
    id: body.data.object.customer,
    name: body.data.object.customer_name,
    email: body.data.object.customer_email,
    createdAt: new Date().toISOString(),
    status: 'PENDING',
  }
}

const saveClient = async (client: Client) => {
  await dynamoDbClient.putItem({
    TableName: tableName ?? '',
    Item: {
      id: { S: client.id },
      name: { S: client.name },
      email: { S: client.email },
    },
  }).promise();
}

const putMessageInQueue = async (message: string) => {
  await sqsClient.sendMessage({
    QueueUrl: fifoQueueUrl ?? '',
    MessageBody: message,
    MessageGroupId: 'deploy',
  }).promise();
}

export const handler: Handler = async (event: any) => {
  try {
    if (isPaymentConfirmed(event)) {
      const newClient: Client = createClient(JSON.parse(event.body));
      await saveClient(newClient);
      await putMessageInQueue(JSON.stringify(newClient));
      console.log(`Client ${newClient.id} is pending deployment`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Payment confirmed, the infrastructure will be deployed soon',
        }),
      }
    }
    console.log('Payment not confirmed');
    return {
      statusCode: 404,
      body: JSON.stringify({
        message: 'Payment not confirmed, the infrastructure will not be deployed',
      }),
    }
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'An error occurred processing the payment confirmation',
      }),
    }
  }
}