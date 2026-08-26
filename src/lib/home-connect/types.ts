/** OAuth token returned by the Home Connect authorization server. */
export interface OAuthToken {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

/** Persisted Home Connect authorization data. */
export interface HomeConnectAuthentication {
  expiresAt: number;
  token: OAuthToken;
}

/** Minimal appliance identity returned by the Home Connect API. */
export interface Appliance {
  haId: string;
}

/** Response returned by the Home Connect appliance list endpoint. */
export interface HomeAppliancesResponse {
  data: {
    homeappliances: Appliance[];
  };
}

/** Explicit appliance operation that can be initiated over MQTT. */
export type HomeConnectCommandPath = 'programs/active' | 'programs/selected';

/** MQTT-safe command operation names mapped to Home Connect API paths. */
export type HomeConnectCommandOperation = 'programs-active' | 'programs-selected';

/** A validated appliance command ready for the Home Connect API. */
export interface HomeConnectCommand {
  applianceId: string;
  body: { data: HomeConnectProgram };
  operation: HomeConnectCommandOperation;
  path: HomeConnectCommandPath;
}

/** Home Connect program representation used for command validation. */
export interface HomeConnectProgram {
  key: string;
  options?: unknown[];
}

/** Scalar values that can be published directly to MQTT. */
export type MqttScalar = string | number | boolean;
