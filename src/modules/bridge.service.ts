import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CONFIG } from '~/config/config';
import { HomeConnect } from '~/lib/home-connect';
import { MqttService } from '~/modules/mqtt/mqtt.service';

/**
 * Executes `BridgeService`.
 */
@Injectable()
export class BridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly instances: HomeConnect[];
  private timer?: NodeJS.Timeout;

  /**
   * Creates the class instance.
   * @param mqtt - Value of type `MqttService`.
   */
  constructor(mqtt: MqttService) {
    this.instances = CONFIG.instances
      .filter((instance) => instance.enabled)
      .map((instance) => new HomeConnect(instance, mqtt));
  }

  /**
   * Executes `onModuleInit`.
   * @returns Result of type `void`.
   */
  onModuleInit() {
    this.instances.forEach((instance) => instance.setup());
    this.timer = setInterval(() => this.instances.forEach((instance) => instance.loop(Date.now())), 1000);
  }

  /**
   * Executes `onModuleDestroy`.
   * @returns Result of type `void`.
   */
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.instances.forEach((instance) => instance.destroy());
  }

  /**
   * Executes `createAuthorizationUrl`.
   * @param id - Value of type `string | undefined`.
   * @returns Result of type `string`.
   */
  createAuthorizationUrl(id?: string) {
    return this.getInstance(id).createAuthorizationUrl();
  }

  /**
   * Executes `completeAuthorization`.
   * @param state - Value of type `string`.
   * @param code - Value of type `string`.
   * @returns Result of type `Promise<boolean>`.
   */
  async completeAuthorization(state: string, code: string) {
    const instance = this.instances.find((candidate) => candidate.hasAuthorizationState(state));
    return instance ? instance.completeAuthorization(state, code) : false;
  }

  /**
   * Executes `getInstance`.
   * @param id - Value of type `string | undefined`.
   * @returns Result of type `HomeConnect`.
   */
  private getInstance(id?: string) {
    if (id) {
      const instance = this.instances.find((candidate) => candidate.id === id);
      if (!instance) throw new Error(`No enabled Home Connect instance with id ${id}.`);
      return instance;
    }
    if (this.instances.length !== 1) throw new Error('Specify the Home Connect instance id.');
    return this.instances[0];
  }
}
