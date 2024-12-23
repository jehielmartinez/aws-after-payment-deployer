import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { TemplateStack } from "../template.stack";
import { MainStack } from "../main.stack";

export class UsEast1 extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    new TemplateStack(scope, 'template-stack');
    new MainStack(scope, 'main-stack');
  }
}