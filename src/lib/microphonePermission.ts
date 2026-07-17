export type MicrophoneAccessState = "checking" | "granted" | "denied" | "unavailable" | "skipped";

interface MicrophonePermissionStatus {
  state: PermissionState;
}

interface MicrophonePermissions {
  query(descriptor: PermissionDescriptor): Promise<MicrophonePermissionStatus>;
}

interface MicrophoneTrack {
  stop(): void;
}

interface MicrophoneStream {
  getTracks(): MicrophoneTrack[];
}

interface MicrophoneMediaDevices {
  getUserMedia(constraints?: MediaStreamConstraints): Promise<MicrophoneStream>;
}

type MicrophoneAccessEnvironment = {
  secureContext: boolean;
  mediaDevices?: MicrophoneMediaDevices;
  permissions?: MicrophonePermissions;
};

const microphoneConstraints: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: true
  }
};

let browserPreflight: Promise<MicrophoneAccessState> | null = null;

function isPermissionDeniedError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}

export async function probeMicrophoneAccess(environment: MicrophoneAccessEnvironment): Promise<MicrophoneAccessState> {
  if (!environment.secureContext || !environment.mediaDevices?.getUserMedia) return "unavailable";

  if (environment.permissions?.query) {
    try {
      const permission = await environment.permissions.query({ name: "microphone" as PermissionName });
      if (permission.state === "denied") return "denied";
    } catch {
      // Safari does not consistently expose microphone through Permissions API.
      // getUserMedia remains the reliable cross-browser check.
    }
  }

  try {
    const stream = await environment.mediaDevices.getUserMedia(microphoneConstraints);
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch (error) {
    return isPermissionDeniedError(error) ? "denied" : "unavailable";
  }
}

function getBrowserEnvironment(): MicrophoneAccessEnvironment {
  return {
    secureContext: window.isSecureContext,
    mediaDevices: navigator.mediaDevices,
    permissions: navigator.permissions
  };
}

export function preflightMicrophoneAccess(force = false): Promise<MicrophoneAccessState> {
  if (!force && browserPreflight) return browserPreflight;
  browserPreflight = probeMicrophoneAccess(getBrowserEnvironment());
  return browserPreflight;
}
