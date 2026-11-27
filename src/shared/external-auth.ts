import type { AccountSummary } from './types';
export interface ExternalServer {
    id: string;
    url: string;
    name: string;
    registerUrl?: string;
    homepage?: string;
}
export interface ExternalLoginInput {
    serverId: string;
    username: string;
    password: string;
    attemptId?: string;
}
export type ExternalLoginResult = {
    status: 'completed';
    account: AccountSummary;
} | {
    status: 'select';
    attemptId: string;
    profiles: {
        id: string;
        name: string;
    }[];
};
export interface InjectorStatus {
    ready: boolean;
    version?: string;
    sha256?: string;
}
export interface ExternalAuthCommandMap {
    'external.servers': {
        payload: undefined;
        result: ExternalServer[];
    };
    'external.addServer': {
        payload: string;
        result: ExternalServer;
    };
    'external.removeServer': {
        payload: string;
        result: void;
    };
    'external.login': {
        payload: ExternalLoginInput;
        result: ExternalLoginResult;
    };
    'external.selectProfile': {
        payload: {
            attemptId: string;
            profileId: string;
        };
        result: AccountSummary;
    };
    'external.cancel': {
        payload: string;
        result: void;
    };
    'external.refresh': {
        payload: string;
        result: AccountSummary;
    };
    'external.validate': {
        payload: string;
        result: boolean;
    };
    'external.signout': {
        payload: {
            id: string;
            password: string;
        };
        result: void;
    };
    'external.injectorStatus': {
        payload: undefined;
        result: InjectorStatus;
    };
    'external.prepareInjector': {
        payload: undefined;
        result: InjectorStatus;
    };
    'external.openRegistration': {
        payload: string;
        result: void;
    };
}
export type ExternalAuthPolicy = {
    kind: 'any';
} | {
    kind: 'external';
    serverId: string;
};
export function validateExternalAuthPolicy(value: unknown): ExternalAuthPolicy {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('无效实例认证策略');
    const x = value as Record<string, unknown>;
    if (x.kind === 'any' && Object.keys(x).length === 1)
        return { kind: 'any' };
    if (x.kind === 'external' && Object.keys(x).length === 2 && typeof x.serverId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x.serverId))
        return { kind: 'external', serverId: x.serverId };
    throw Error('无效实例认证策略');
}
