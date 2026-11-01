import { useEffect, useReducer, useState } from "react";
import { cn } from "./utils.ts";
import { Button } from "./shad/button";
import ApiSetNodeCard from "./ApiSetNodeCard";
import ProviderAdditionDialog from "./ProviderAddition.tsx";
import type { ApiSetEngine, ApiSetEngineEvents } from "../../apisets";

interface ApiSetsComponentProps {
  className?: string;
  engine: ApiSetEngine;
}

/** One tab per API set of `engine`: its ranked nodes, the node in use and the user's choice. */
const ApiSetsComponent: React.FC<ApiSetsComponentProps> = ({ className, engine }) => {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const sets = engine.sets();
  const [activeSetId, setActiveSetId] = useState(sets[0]?.id);
  const [notice, setNotice] = useState<ApiSetEngineEvents["selectionfallback"] | undefined>(undefined);

  useEffect(() => {
    const unsubscribers = [
      engine.on("change", rerender),
      engine.on("selectionfallback", setNotice),
      engine.on("selectionrestored", ({ setId }) => setNotice((current) => (current?.setId === setId ? undefined : current))),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [engine]);

  const activeSet = sets.find((set) => set.id === activeSetId);
  const group = engine.groups().find((status) => status.group === activeSet?.group);

  return (
    <div className={cn(className)}>
      <h2 className="text-xl text-left">API servers by API set</h2>
      <div role="tablist" className="flex flex-wrap gap-2 my-2">
        {sets.map((set) => (
          <Button
            key={set.id}
            role="tab"
            aria-selected={set.id === activeSetId}
            variant={set.id === activeSetId ? "default" : "outline"}
            onClick={() => setActiveSetId(set.id)}
          >
            {set.title}
          </Button>
        ))}
      </div>
      {notice && (
        <p role="status" className="my-2 text-orange-600" data-testid="hc-set-fallback">
          {`${notice.selected} is unavailable for ${engine.sets().find((set) => set.id === notice.setId)?.title ?? notice.setId}; using ${notice.node ?? "no node"} until it recovers.`}
        </p>
      )}
      {group?.split && (
        <p className="my-2 text-sm text-gray-600 dark:text-gray-300" data-testid="hc-set-group-split">
          {`No single node serves all of ${group.sets.join(", ")}: ${group.sets
            .map((setId) => `${setId} uses ${group.nodesBySet[setId] ?? "no node"}`)
            .join(", ")}.`}
        </p>
      )}
      {activeSet && (
        <div role="tabpanel" aria-label={activeSet.title}>
          <div className="flex items-center justify-between my-2">
            <span data-testid="hc-set-selection">
              {engine.selection(activeSet.id) === "auto" ? "Automatic choice" : `Your choice: ${engine.selection(activeSet.id)}`}
            </span>
            {engine.selection(activeSet.id) !== "auto" && (
              <Button variant="outline" onClick={() => engine.select(activeSet.id, "auto")}>
                Use automatic choice
              </Button>
            )}
          </div>
          {engine.rankings(activeSet.id).map((ranking, index) => (
            <ApiSetNodeCard
              key={ranking.node}
              ranking={ranking}
              index={index + 1}
              onSelect={(node) => engine.select(activeSet.id, node)}
              onSelectEverywhere={(node) => engine.selectEverywhere(node)}
              onRemove={(node) => engine.removeNode(node)}
            />
          ))}
        </div>
      )}
      <ProviderAdditionDialog onProviderSubmit={(node) => engine.addNode(node)} />
    </div>
  );
};

export { ApiSetsComponent };
