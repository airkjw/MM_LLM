/** Saved credentials must select their local vault before any remote startup call. */
export async function activateSavedSession<T>(
  key: string, activate: (key: string) => Promise<void>, loadRemote: () => Promise<T>
): Promise<T> {
  await activate(key);
  return loadRemote();
}

export type LoginTransitionOps<T> = {
  validateRemote: (key: string) => Promise<T>;
  commitRuntime: (key: string, value: T) => void;
  activate: (key: string) => Promise<void>;
  saveKey: (key: string) => Promise<void>;
  clearProfile: () => void;
  deleteKey: () => Promise<void>;
};

/** Validates without changing runtime globals, then commits disk and runtime as one transition. */
export async function transitionLogin<T>(key: string, previous: string | null, ops: LoginTransitionOps<T>): Promise<T> {
  try {
    const value = await ops.validateRemote(key);
    await ops.activate(key);
    await ops.saveKey(key);
    ops.commitRuntime(key, value);
    return value;
  } catch (error) {
    if (previous) {
      await ops.activate(previous);
      await ops.saveKey(previous);
    } else {
      ops.clearProfile();
      await ops.deleteKey();
    }
    throw error;
  }
}
