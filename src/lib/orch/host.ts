import { createServerFn } from "@tanstack/react-start";
import type { HostSnapshot } from "../bunny-host/contracts.ts";
import type { MissionView } from "../bunny-missions/types.ts";
import type { OrchTask } from "./types";
import { dashboardSnapshot } from "../bunny-host/presentation.ts";

export const readBunnyHost = createServerFn({ method: "POST" })
  .validator((data: { after?: number }) => data)
  .handler(async ({ data }): Promise<HostSnapshot> => {
    const { hostRequest } = await import("./host-bridge.server.ts");
    return dashboardSnapshot(
      (await hostRequest(`/state?after=${Number(data.after ?? 0)}`)) as HostSnapshot,
    );
  });
export const commandBunnyHost = createServerFn({ method: "POST" })
  .validator((data: { action: string; data: Record<string, unknown> }) => data)
  .handler(
    async ({
      data,
    }): Promise<{
      snapshot: HostSnapshot;
      task?: OrchTask;
      pairCode?: string;
      mission?: MissionView;
    }> => {
      const { hostRequest } = await import("./host-bridge.server.ts");
      const result = (await hostRequest("/command", data)) as {
        snapshot: HostSnapshot;
        task?: OrchTask;
        pairCode?: string;
        mission?: MissionView;
      };
      const snapshot = dashboardSnapshot(result.snapshot);
      return {
        ...result,
        snapshot,
        task: result.task ? snapshot.tasks.find((task) => task.id === result.task!.id) : undefined,
        mission: result.mission
          ? snapshot.missions?.missions.find((mission) => mission.id === result.mission!.id)
          : undefined,
      };
    },
  );
