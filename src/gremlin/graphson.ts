import * as _ from 'lodash';

export class Graphson {
  requestId: string;
  op: string;
  processor: string;
  args: {}

  constructor(options: any) {
    _.assign(this, options);
  }
}
