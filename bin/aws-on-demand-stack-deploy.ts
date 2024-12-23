#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { UsEast1 } from '../lib/stages/usEast1.stage';

const app = new cdk.App();
new UsEast1(app, 'UsEast1', {
  env: { account: '123456789012', region: 'us-east-1' },
});