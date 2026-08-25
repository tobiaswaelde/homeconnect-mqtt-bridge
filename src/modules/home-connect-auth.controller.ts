import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  Redirect,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { BridgeService } from './bridge.service';

/**
 * Executes `HomeConnectAuthController`.
 */
@Controller('home-connect')
export class HomeConnectAuthController {
  /**
   * Creates the class instance.
   * @param bridge - Value of type `BridgeService`.
   */
  constructor(private readonly bridge: BridgeService) {}

  /** Redirects the browser to Home Connect's unmodified consent screen.
   * @param instance - Value of type `string | undefined`.
   * @returns Result of type `{ url: string; }`.
   */
  @Get('authorize')
  @Redirect()
  @Version(VERSION_NEUTRAL)
  authorize(@Query('instance') instance?: string) {
    try {
      return { url: this.bridge.createAuthorizationUrl(instance) };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Could not start Home Connect authorization.',
      );
    }
  }

  /** Receives the authorization code, verifies OAuth state, and shows the browser result.
   * @param code - Value of type `string | undefined`.
   * @param state - Value of type `string | undefined`.
   * @param error - Value of type `string | undefined`.
   * @returns Result of type `Promise<string>`.
   */
  @Get('callback')
  @Header('content-type', 'text/html; charset=utf-8')
  @Version(VERSION_NEUTRAL)
  async callback(@Query('code') code?: string, @Query('state') state?: string, @Query('error') error?: string) {
    if (error) throw new BadRequestException(`Home Connect authorization failed: ${error}`);
    if (!code || !state) throw new BadRequestException('Home Connect callback is missing code or state.');

    if (!(await this.bridge.completeAuthorization(state, code))) {
      throw new BadRequestException('Home Connect authorization is invalid, expired, or could not be completed.');
    }
    return '<!doctype html><title>Home Connect authenticated</title><p>Home Connect was authenticated. You can close this window.</p>';
  }
}
