import { GremlinClientOptions } from './gremlin-client-options';
import { GremlinEvent } from './gremlin.event';
import { GremlinQuery } from './gremlin.query';
import { GremlinQueryResponse } from './gremlin.query.response';

export class GremlinWebSocket {
  private _ws: WebSocket;
  private _queries: {[id: string]: GremlinQuery} = {};
  private _queue = new Array<GremlinQuery>();

  socket() {
    return this._ws;
  }

  close() {
    this._ws.close();
  }

  isOpen() {
    return this._ws && this._ws.OPEN === this._ws.readyState;
  }

  sendMessage(gremlinQuery: GremlinQuery) {
    if (!this.isOpen()) {
      this._queue.push(gremlinQuery);
      return false;
    } else {
      console.log('sending request');
      console.log(gremlinQuery);
      this._queries[gremlinQuery.id] = gremlinQuery;
      this._ws.send(gremlinQuery.binaryFormat());
      return true;
    }
  }

  /**
   * Process the current command queue, sending commands to Gremlin Server
   * (First In, First Out).
   */
  executeQueue() {
    while (this._queue.length > 0) {
      const query = this._queue.shift();
      setTimeout(this.sendMessage(query), 1000);
    }
  }

  arrayBufferToString(buffer) {
    console.log('converting buffer to string');
    const bufView = new Uint8Array(buffer);
    const length = bufView.length;
    let result = '';
    let addition = Math.pow(2, 8) - 1;

    for (let i = 0; i < length; i += addition) {

        if (i + addition > length) {
            addition = length - i;
        }
        result += String.fromCharCode.apply(null, bufView.subarray(i, i + addition));
    }
    console.log('extracted string from buffer: ' + result);
    return result;
}

  /*
  *  Process all incoming raw message events sent by Gremlin Server, and dispatch
  *  to the appropriate command.
  *
  */
  onMessage(message) {
    let rawMessage;
    let requestId;
    let statusCode;
    let statusMessage;

    console.log('web socket received message');

    try {
      const {data} = message;
      const rawMessageString = this.arrayBufferToString(data);
      rawMessage = JSON.parse(rawMessageString);
      requestId = rawMessage.requestId;
      statusCode = rawMessage.status.code;
      statusMessage = rawMessage.status.message;
    } catch (e) {
      console.warn('MalformedResponse', 'Received malformed response message');
      console.log(message);
      return;
    }

    const gremlinResponse = new GremlinQueryResponse();
    gremlinResponse.rawMessage = rawMessage;
    gremlinResponse.requestId = requestId;
    gremlinResponse.statusCode = statusCode;
    gremlinResponse.statusMessage = statusMessage;

    console.log('preparing to excecute callback for request');

    // If we didn't find a waiting query for this response, emit a warning
    if (!this._queries[requestId]) {
      console.warn(
        'OrphanedResponse',
        `Received response for missing or closed request: ${requestId}, status: ${statusCode}, ${statusMessage}`,
      );
      return;
    }

    const query = this._queries[requestId];

    switch (statusCode) {
      case 200: // SUCCESS
        delete this._queries[requestId]; // TODO: optimize performance
        query.onMessage(gremlinResponse);
        query.onMessage(null);
        break;
      case 204: // NO_CONTENT
        delete this._queries[requestId];
        query.onMessage(null);
        break;
      case 206: // PARTIAL_CONTENT
        query.onMessage(rawMessage);
        break;
      case 407: // AUTHENTICATE CHALLANGE
        // const challengeResponse = this.buildChallengeResponse(requestId);
        // this.sendMessage(challengeResponse);
        // TODO: create authentication
        console.error('requires authentication');
        break;
      default:
        delete this._queries[requestId];
        console.error(statusMessage + ' (Error ' + statusCode + ')');
        break;
    }
  }

  onOpen(evt) {
    console.log('opened connection');
    this.executeQueue();
  }

  onError(err) {
    console.log('an error occured');
    console.error(err);
  }

  buildChallengeResponse(requestId) {
    const {processor, op, accept, language, aliases} = this.options;
    const saslbase64 = new Buffer('\0' + this.options.user + '\0' + this.options.password).toString('base64');
    const args = {sasl: saslbase64}

    const message = {
      requestId,
      processor,
      op: 'authentication',
      args,
    };

    return message;
  }

  isConnecting() {
    return this._ws && this._ws.readyState === this._ws.CONNECTING;
  }

  open() {
    if (this.isOpen() || this.isConnecting()) {
      return;
    }
    const address = `ws${this.options.ssl ? 's' : ''}://${this.options.host}:${this.options.port}${this.options.path}`;
    this._ws = new WebSocket(address);
    this._ws.binaryType = 'arraybuffer';
    this._ws.onopen = (evt) => { this.onOpen(evt) };
    this._ws.onerror = (evt) => { this.onError(evt) };
    this._ws.onmessage = (evt) => { this.onMessage(evt) };
  }

  constructor(private options: GremlinClientOptions) {
    this.open();
  }
}
