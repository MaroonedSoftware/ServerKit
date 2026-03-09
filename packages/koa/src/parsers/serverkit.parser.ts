import { IncomingMessage } from 'http';
import { Injectable } from 'injectkit';

export type ServerKitParserResult = {
  parsed: unknown;
  raw: unknown;
};

@Injectable()
export abstract class ServerKitParser {
  abstract parse(req: IncomingMessage): Promise<ServerKitParserResult>;
}
