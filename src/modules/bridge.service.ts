import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CONFIG, type ActiveHomeConnectConfig, type HomeConnectConfig } from '~/config/config';
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
   * @param {MqttService} mqtt The mqtt value.
   */
  constructor(@Inject(MqttService) mqtt: MqttService) {
    this.instances = CONFIG.instances
      .filter((instance): instance is ActiveHomeConnectConfig => isEnabledInstance(instance))
      .map((instance) => new HomeConnect(instance, mqtt));
  }

  /**
   * Executes `onModuleInit`.
   * @returns {void} Result.
   */
  onModuleInit() {
    this.instances.forEach((instance) => instance.setup());
    this.timer = setInterval(() => this.instances.forEach((instance) => instance.loop(Date.now())), 1000);
  }

  /**
   * Executes `onModuleDestroy`.
   * @returns {void} Result.
   */
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.instances.forEach((instance) => instance.destroy());
  }

  /**
   * Executes `createAuthorizationUrl`.
   * @param {string | undefined} id The id value.
   * @returns {string} Result.
   */
  createAuthorizationUrl(id?: string) {
    return this.getInstance(id).createAuthorizationUrl();
  }

  /**
   * Executes `completeAuthorization`.
   * @param {string} state The state value.
   * @param {string} code The code value.
   * @returns {Promise<boolean>} Result.
   */
  async completeAuthorization(state: string, code: string) {
    const instance = this.instances.find((candidate) => candidate.hasAuthorizationState(state));
    return instance ? instance.completeAuthorization(state, code) : false;
  }

  /**
   * Executes `getInstance`.
   * @param {string | undefined} id The id value.
   * @returns {HomeConnect} Result.
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

function isEnabledInstance(instance: HomeConnectConfig): instance is ActiveHomeConnectConfig {
  return instance.enabled;
}
