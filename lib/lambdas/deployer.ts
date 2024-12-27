import { SQSEvent, Handler } from "aws-lambda";
import { SQS, DynamoDB, CloudFormation } from "aws-sdk";
import { Client } from "./webhook";

const sqsClient = new SQS();
const dynamoDbClient = new DynamoDB();
const cloudformation = new CloudFormation();
const tableName = process.env.CLIENTS_TABLE;
const fifoQueueUrl = process.env.FIFO_QUEUE;

// The cloudformation template is hardcoded in this example, 
// but it can be retrieved from an S3 bucket or a parameter store
const getTemplateBody = () => {
  return `
AWSTemplateFormatVersion: "2010-09-09"
Description: Deploy an EC2 instance with a simple web server in a custom VPC with a public subnet.

Parameters:
  StackName:
    Type: String
    Description: Name of the stack to prefix the resource names.
  
  LatestAmazonLinux2AMI:
    Type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>"
    Default: "/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2"
    Description: Latest Amazon Linux 2 AMI ID.

Resources:
  # VPC
  MyVPC:
    Type: "AWS::EC2::VPC"
    Properties:
      CidrBlock: "10.0.0.0/16"
      EnableDnsSupport: true
      EnableDnsHostnames: true
      Tags:
        - Key: "Name"
          Value: !Sub "\${StackName}-Vpc"

  # Internet Gateway
  InternetGateway:
    Type: "AWS::EC2::InternetGateway"
    Properties:
      Tags:
        - Key: "Name"
          Value: !Sub "\${StackName}-InternetGateway"

  AttachGateway:
    Type: "AWS::EC2::VPCGatewayAttachment"
    Properties:
      VpcId: !Ref MyVPC
      InternetGatewayId: !Ref InternetGateway

  # Public Subnet
  PublicSubnet:
    Type: "AWS::EC2::Subnet"
    Properties:
      VpcId: !Ref MyVPC
      CidrBlock: "10.0.1.0/24"
      MapPublicIpOnLaunch: true
      AvailabilityZone: !Select [0, !GetAZs ""]
      Tags:
        - Key: "Name"
          Value: !Sub "\${StackName}-PublicSubnet"

  # Route Table and Route
  RouteTable:
    Type: "AWS::EC2::RouteTable"
    Properties:
      VpcId: !Ref MyVPC
      Tags:
        - Key: "Name"
          Value: !Sub "\${StackName}-RouteTable"

  PublicRoute:
    Type: "AWS::EC2::Route"
    Properties:
      RouteTableId: !Ref RouteTable
      DestinationCidrBlock: "0.0.0.0/0"
      GatewayId: !Ref InternetGateway

  SubnetRouteTableAssociation:
    Type: "AWS::EC2::SubnetRouteTableAssociation"
    Properties:
      SubnetId: !Ref PublicSubnet
      RouteTableId: !Ref RouteTable

  # Security Group
  WebServerSecurityGroup:
    Type: "AWS::EC2::SecurityGroup"
    Properties:
      GroupDescription: "Allow HTTP traffic"
      VpcId: !Ref MyVPC
      Tags:
        - Key: "Name"
          Value: !Sub "\${StackName}-SecurityGroup"
      SecurityGroupIngress:
        - IpProtocol: "tcp"
          FromPort: 80
          ToPort: 80
          CidrIp: "0.0.0.0/0"

  # EC2 Instance
  WebServerInstance:
    Type: "AWS::EC2::Instance"
    Properties:
      InstanceType: "t2.micro"
      ImageId: !Ref LatestAmazonLinux2AMI
      SubnetId: !Ref PublicSubnet
      SecurityGroupIds:
        - !Ref WebServerSecurityGroup
      Tags:
        - Key: "Name"
          Value: !Sub "\${StackName}-Instance"
      UserData:
        Fn::Base64: !Sub |
          #!/bin/bash
          yum update -y
          yum install -y httpd
          echo "<h1>Server is ready!</h1>" > /var/www/html/index.html
          systemctl start httpd
          systemctl enable httpd

Outputs:
  InstancePublicIp:
    Description: Public IP address of the EC2 instance
    Value: !GetAtt WebServerInstance.PublicIp
    Export:
      Name: !Sub "\${StackName}-InstancePublicIp"
  InstancePublicDnsName:
    Description: Public DNS name of the EC2 instance
    Value: !GetAtt WebServerInstance.PublicDnsName
    Export:
      Name: !Sub "\${StackName}-InstancePublicDnsName"
  `;
}

const deployStack = (client: Client) => {
  const stackName = `Client-${client.id.replace(/[^a-zA-Z0-9-]/g, '')}`;
  return cloudformation.createStack({
    StackName: stackName,
    //TemplateURL: 'https://s3.amazonaws.com/cloudformation-templates-us-east-1/EC2InstanceWithSecurityGroupSample.template',
    TemplateBody: getTemplateBody(),
    Parameters: [
      {
        ParameterKey: 'StackName',
        ParameterValue: stackName,
      },
    ],
    Capabilities: ['CAPABILITY_IAM'],
  }).promise();
}

const updateClientStatus = (client: Client) => {
  return dynamoDbClient.updateItem({
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

const deleteMessage = (receiptHandle: string) => {
  return sqsClient.deleteMessage({
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
    console.log(`Client ${client.id} is being deployed`);
    await updateClientStatus(client);
    console.log(`Client ${client.id} status updated to DEPLOYING`);
    await deleteMessage(record.receiptHandle);
    console.log(`Message ${record.messageId} deleted`);
    return true;
  } catch (error) {
    console.error('Error processing message:', error);
    throw error;
  }
}