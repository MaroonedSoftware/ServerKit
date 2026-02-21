import { IncomingMessage } from 'http';
import { Injectable } from 'injectkit';

export type ServerKitParserResult = {
  parsed: any;
  raw: any;
};

@Injectable()
export abstract class ServerKitParser {
  abstract parse(req: IncomingMessage): Promise<ServerKitParserResult>;
}
