import { Module } from '@nestjs/common';
import { MqttModule } from '~/modules/mqtt/mqtt.module';
import { BridgeService } from './bridge.service';
import { HomeConnectAuthController } from './home-connect-auth.controller';

/**
 * Executes `BridgeModule`.
 */
@Module({ imports: [MqttModule], controllers: [HomeConnectAuthController], providers: [BridgeService] })
export class BridgeModule {}
