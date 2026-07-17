export interface ParentUserRecord {
  id: string;
  householdId: string;
  householdName: string;
  username: string;
  role: string;
  status: string;
  passwordHash?: string;
}

export interface ParentSessionRecord {
  sessionId: string;
  expiresAt: string;
  id: string;
  householdId: string;
  householdName: string;
  username: string;
  role: string;
}

export interface ChildDeviceSessionRecord {
  sessionId: string;
  expiresAt: string;
  householdId: string;
  householdName: string;
  childId: string;
  childName: string;
  label: string;
}

export interface RegistrationKeyRecord {
  id: string;
  keyPrefix: string;
  batchId: string;
  label: string;
  note: string;
  maxUses: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface ChildPairingCodeRecord {
  id: string;
  childId: string;
  expiresAt: string;
  createdAt: string;
}
