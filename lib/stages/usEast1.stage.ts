import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { TemplateStack } from "../stacks/template.stack";
import { MainStack } from "../stacks/main.stack";

export class UsEast1 extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);
    // Only uncomment the Template stack to generate the CloudFormation template 
    // new TemplateStack(scope, 'template-stack');
    new MainStack(scope, 'main-stack');
  }
}