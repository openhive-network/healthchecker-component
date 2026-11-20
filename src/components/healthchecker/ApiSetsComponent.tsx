import { useEffect, useReducer, useState } from "react";
import { cn } from "./utils.ts";
import { Button } from "./shad/button";
import ApiSetNodeCard from "./ApiSetNodeCard";
import ProviderAdditionDialog from "./ProviderAddition.tsx";
import { DEFAULT_API_SETS_LABELS, formatLabel, type ApiSetsLabels } from "./labels";
import type { ApiSetEngine, ApiSetEngineEvents } from "../../apisets";

interface ApiSetsComponentProps {
  className?: string;
  engine: ApiSetEngine;
  /** The component's text; a missing key keeps its English default. */
  labels?: Partial<ApiSetsLabels>;
  /** Per set id, the title to show instead of the engine config's `title` (and, in the group notice, the id). */
  setTitles?: Record<string, string>;
}

/** One tab per API set of `engine`: its ranked nodes, the node in use and the user's choice. */
const ApiSetsComponent: React.FC<ApiSetsComponentProps> = ({ className, engine, labels: labelOverrides, setTitles }) => {
  const labels: ApiSetsLabels = { ...DEFAULT_API_SETS_LABELS, ...labelOverrides };
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
  const titleOf = (setId: string) => setTitles?.[setId] ?? sets.find((set) => set.id === setId)?.title ?? setId;
  // The group notice names sets by id unless the app gave display titles.
  const splitSetName = (setId: string) => setTitles?.[setId] ?? setId;
  const group = engine.groups().find((status) => status.group === activeSet?.group);

  return (
    <div className={cn(className)}>
      <h2 className="text-xl text-left">{labels.heading}</h2>
      <div role="tablist" className="flex flex-wrap gap-2 my-2">
        {sets.map((set) => (
          <Button
            key={set.id}
            role="tab"
            aria-selected={set.id === activeSetId}
            variant={set.id === activeSetId ? "default" : "outline"}
            onClick={() => setActiveSetId(set.id)}
          >
            {titleOf(set.id)}
          </Button>
        ))}
      </div>
      {notice && (
        <p role="status" className="my-2 text-orange-600" data-testid="hc-set-fallback">
          {formatLabel(labels.fallbackNotice, {
            selected: notice.selected,
            set: titleOf(notice.setId),
            node: notice.node ?? labels.noNode,
          })}
        </p>
      )}
      {group?.split && (
        <p className="my-2 text-sm text-gray-600 dark:text-gray-300" data-testid="hc-set-group-split">
          {formatLabel(labels.groupSplit, {
            sets: group.sets.map(splitSetName).join(labels.listSeparator),
            nodes: group.sets
              .map((setId) =>
                formatLabel(labels.groupSplitSet, { set: splitSetName(setId), node: group.nodesBySet[setId] ?? labels.noNode }),
              )
              .join(labels.listSeparator),
          })}
        </p>
      )}
      {activeSet && (
        <div role="tabpanel" aria-label={titleOf(activeSet.id)}>
          <div className="flex items-center justify-between my-2">
            <span data-testid="hc-set-selection">
              {engine.selection(activeSet.id) === "auto"
                ? labels.automaticChoice
                : formatLabel(labels.yourChoiceOf, { node: engine.selection(activeSet.id) })}
            </span>
            {engine.selection(activeSet.id) !== "auto" && (
              <Button variant="outline" onClick={() => engine.select(activeSet.id, "auto")}>
                {labels.useAutomaticChoice}
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
              labels={labels}
            />
          ))}
        </div>
      )}
      <ProviderAdditionDialog onProviderSubmit={(node) => engine.addNode(node)} labels={labels} />
    </div>
  );
};

export { ApiSetsComponent };
