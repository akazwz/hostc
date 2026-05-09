export type HostcEnv = Env & {
	TOKEN_SECRET: string;
	ALLOW_LOCAL_TUNNEL_HEADER?: string;
};
