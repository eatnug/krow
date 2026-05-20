export interface PlannedTask {
  id: string;
  title: string;
  scope: string;
  depends_on?: string[];
  files?: string[];
  responsibility?: string;
  parallel_group?: string;
  expected_output: string;
  merge_plan?: string;
}

export interface TaskState {
  id: string;
  status: "planned" | "ready" | "running" | "done" | "blocked";
  depends_on?: string[];
  owner?: string;
  files?: string[];
  responsibility?: string;
  parallel_group?: string;
  expected_output?: string;
  blocked_by?: string[];
  output_path?: string;
}

export function plannedTasksToState(tasks: PlannedTask[] | undefined): TaskState[] {
  const planned = tasks ?? [];
  return planned.map((task) => {
    const dependencies = task.depends_on ?? [];
    return {
      id: task.id,
      status: dependencies.length === 0 ? "ready" : "planned",
      depends_on: dependencies,
      owner: task.files?.join(", ") ?? task.responsibility,
      files: task.files ?? [],
      responsibility: task.responsibility,
      parallel_group: task.parallel_group,
      expected_output: task.expected_output,
      blocked_by: dependencies,
    };
  });
}

export function readyTaskIds(tasks: TaskState[] | undefined): string[] {
  const states = tasks ?? [];
  const done = new Set(states.filter((task) => task.status === "done").map((task) => task.id));
  return states
    .filter((task) => task.status === "ready" || task.status === "planned")
    .filter((task) => (task.depends_on ?? []).every((dependency) => done.has(dependency)))
    .map((task) => task.id);
}
