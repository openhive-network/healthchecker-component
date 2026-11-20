import { X } from "lucide-react";
import { cn } from "./utils.ts";
import { Button } from "./shad/button";
import { Card } from "./shad/card";
import { Badge } from "./shad/badge";
import { formatLabel, type ApiSetsLabels } from "./labels";
import type { NodeRanking, NodeState } from "../../apisets";

interface ApiSetNodeCardProps {
  ranking: NodeRanking;
  index: number;
  onSelect: (node: string) => void;
  onSelectEverywhere: (node: string) => void;
  onRemove: (node: string) => void;
  labels: ApiSetsLabels;
}

const STATE_CLASSES: Record<NodeRanking["state"], string> = {
  eligible: "border-green-600 text-green-700 dark:text-green-400",
  unsupported: "border-gray-400 text-gray-500",
  down: "border-red-600 text-red-600",
  unknown: "border-gray-400 text-gray-500",
};

const STATE_LABELS: Record<NodeState, keyof ApiSetsLabels> = {
  eligible: "stateEligible",
  unsupported: "stateUnsupported",
  down: "stateDown",
  unknown: "stateUnknown",
};

const formatMs = (labels: ApiSetsLabels, ms?: number) =>
  ms === undefined ? labels.noValue : formatLabel(labels.milliseconds, { value: Math.round(ms) });

const ApiSetNodeCard: React.FC<ApiSetNodeCardProps> = ({ ranking, index, onSelect, onSelectEverywhere, onRemove, labels }) => {
  const { node, state, reason, features, degraded, isDefault, isSelected, isActive, isCustom } = ranking;
  return (
    <Card
      className={cn("relative flex flex-col gap-2 my-1 p-4 dark:text-white", {
        "outline-solid outline-2 outline-offset-2": isActive,
      })}
      data-testid="hc-set-node"
    >
      {isCustom && !isSelected && (
        <div className="absolute top-0 right-2">
          <Button className="p-1 rounded-sm" onClick={() => onRemove(node)} variant="ghost" aria-label={formatLabel(labels.removeNode, { node })}>
            <X className="w-4 h-4 dark:text-white" />
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <p>{index}</p>
        <p data-testid="hc-set-node-url">{node}</p>
        <Badge variant="outline" className={STATE_CLASSES[state]} data-testid="hc-set-node-state">
          {degraded ? labels.stateDegraded : labels[STATE_LABELS[state]]}
        </Badge>
        {isDefault && <Badge variant="secondary">{labels.defaultBadge}</Badge>}
        {isSelected && <Badge variant="secondary">{labels.yourChoiceBadge}</Badge>}
        {isActive && <span className="text-green-600" data-testid="hc-set-node-active">{labels.inUse}</span>}
      </div>
      {reason && <p className="text-xs text-gray-500 dark:text-gray-400">{reason}</p>}
      {state === "eligible" && (
        <div className="flex flex-wrap gap-4 text-sm">
          <span>{formatLabel(labels.median, { value: formatMs(labels, ranking.medianLatencyMs) })}</span>
          <span>{formatLabel(labels.p95, { value: formatMs(labels, ranking.p95LatencyMs) })}</span>
          {ranking.errorRate !== undefined && <span>{formatLabel(labels.errors, { value: Math.round(ranking.errorRate * 100) })}</span>}
          {ranking.freshnessLag !== undefined && <span>{formatLabel(labels.lag, { value: ranking.freshnessLag })}</span>}
        </div>
      )}
      {!!features?.length && (
        <div className="flex flex-wrap gap-1">
          {features.map((feature) => (
            <Badge key={feature} variant="outline" className="m-0.5">
              {feature}
            </Badge>
          ))}
        </div>
      )}
      {state === "eligible" && (
        <div className="flex flex-wrap gap-2">
          {!isSelected && (
            <Button className="rounded-sm" onClick={() => onSelect(node)} data-testid="hc-set-node-use">
              {labels.use}
            </Button>
          )}
          <Button variant="outline" className="rounded-sm" onClick={() => onSelectEverywhere(node)}>
            {labels.useEverywhere}
          </Button>
        </div>
      )}
    </Card>
  );
};

export default ApiSetNodeCard;
