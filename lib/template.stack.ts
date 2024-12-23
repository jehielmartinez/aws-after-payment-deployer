import { Stack, StackProps, CfnParameter, CfnOutput, Stage, BootstraplessSynthesizer } from "aws-cdk-lib";
import { Instance, InstanceClass, InstanceSize, InstanceType, MachineImage, Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export class TemplateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const stackIdParam = new CfnParameter(this, "stackId", {
      default: "whatever-id",
      description: "Identifier for the stack",
    });

    const stackId = stackIdParam.valueAsString;
    const vpc = new Vpc(this, `vpc`, {
      maxAzs: 2,
    });
    const instance = new Instance(this, `instance`, {
      vpc: vpc,
      instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
      machineImage: MachineImage.latestAmazonLinux2(),
      instanceName: `${stackId}-instance`,
    });

    new CfnOutput(this, "instanceIp", {
      value: instance.instancePublicIp,
      description: "Public IP of the instance",
    })
  }
}