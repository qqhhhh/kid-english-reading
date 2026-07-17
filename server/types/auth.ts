export interface ParentAccessSession {
  kind: "parent";
  sessionId: string;
  expiresAt: string;
  id: string;
  householdId: string;
  householdName: string;
  username: string;
  role: string;
}

export interface ChildAccessSession {
  kind: "child";
  sessionId: string;
  expiresAt: string;
  householdId: string;
  householdName: string;
  childId: string;
  childName: string;
  label: string;
}

export interface ReviewAccessSession {
  kind: "review";
  sessionId: string;
  householdId: string;
  householdName: string;
  childId: string;
  childName: string;
  label: string;
}

export type AccessSession = ParentAccessSession | ChildAccessSession | ReviewAccessSession;

export interface CourseSyncAuth {
  keyId: string;
  legacy: boolean;
}
