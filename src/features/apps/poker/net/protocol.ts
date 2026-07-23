import type { ActionRequest, TableState } from "../engine";

export type PeerHello = {
  type: "hello";
  playerId: string;
  name: string;
  avatar: string;
  chips: number;
};

export type PeerSit = {
  type: "sit";
  seatIndex: number;
};

export type PeerStand = {
  type: "stand";
};

export type PeerAction = {
  type: "action";
  request: ActionRequest;
};

export type HostWelcome = {
  type: "welcome";
  roomCode: string;
  yourPlayerId: string;
};

export type HostState = {
  type: "state";
  viewerSeatIndex: number | null;
  state: TableState & { holeFaceDown?: boolean[] };
};

export type HostError = {
  type: "error";
  message: string;
};

export type ClientMessage = PeerHello | PeerSit | PeerStand | PeerAction;
export type HostMessage = HostWelcome | HostState | HostError;
export type NetMessage = ClientMessage | HostMessage;
