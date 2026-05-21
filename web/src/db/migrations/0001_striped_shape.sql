ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_session_token_unique";--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD PRIMARY KEY ("session_token");--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP COLUMN "id";