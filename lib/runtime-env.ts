/** Read server environment at request time. Vinext can inline direct process.env
 * expressions during build; this indirection keeps production start-time flags
 * (notably LOCAL_DEV_MODE) observable without exposing secrets to the client. */
export function runtimeEnv(name: string): string | undefined {
  const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return runtimeProcess?.env?.[name];
}
