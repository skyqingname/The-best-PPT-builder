type Listener = (projectId: string) => void;

const listeners = new Set<Listener>();

export function emitProjectChange(projectId: string) {
  for (const listener of listeners) {
    listener(projectId);
  }
}

export function onProjectChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
