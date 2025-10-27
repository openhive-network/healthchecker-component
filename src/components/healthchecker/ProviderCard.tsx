import { cn } from "./utils.ts";
import { Button } from "./shad/button";
import { Card } from "./shad/card";
import { Badge } from "./shad/badge";
import { Loader2, X, OctagonAlert, TriangleAlert } from "lucide-react";

interface ProviderCardProps {
  providerLink: string;
  disabled: boolean;
  isSelected: boolean;
  isTop: boolean;
  checkerNamesList: string[];
  latency: number | null;
  score: number;
  index: number;
  failedErrorChecks: string[];
  failedValidationChecks: string[];
  isHealthCheckerActive: boolean;
  switchToProvider: (providerLink: string | null) => void;
  deleteProvider: (provider: string) => void;
  selectValidator: (providerName: string, checkTitle: string) => void;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  providerLink,
  disabled,
  isSelected,
  isTop,
  checkerNamesList,
  latency,
  score,
  index,
  failedErrorChecks,
  failedValidationChecks,
  isHealthCheckerActive,
  deleteProvider,
  switchToProvider,
  selectValidator,
}) => {


  const handleBadgeClick = (checkerName: string) => {
    if (failedErrorChecks.includes(checkerName) || failedValidationChecks.includes(checkerName))
      selectValidator(providerLink, checkerName);
  };

  if (isTop && index === 1) return null;

  return (
    <Card
      className={cn(
        "relative flex flex-col gap-2 my-1 p-2 dark:text-white",
        "lg:flex-row lg:flex-wrap lg:items-center",
        {
          "outline outline-2 outline-offset-2 mb-6": isTop,
          "border-green-600": isSelected,
        }
      )}
    >
      {!isSelected && (
        <div className="absolute top-0 right-2">
          <Button
            className="p-1 rounded"
            onClick={() => deleteProvider(providerLink)}
            variant="ghost"
          >
            <X className="w-4 h-4 dark:text-white" />
          </Button>
        </div>
      )}
      <div className="flex flex-wrap justify-around p-4 w-full">
        <div className="flex flex-col w-full md:w-1/2">
          <div className="flex gap-4">
            <p>{index}</p>
            <p
              className={cn("text-center", {
                "text-red-600": disabled,
              })}
              data-testid="hc-api-name"
            >
              {providerLink}
            </p>
          </div>
          <div className={"flex flex-wrap items-center gap-2 py-2 pl-4"}>
            {disabled ? (
              <div>
                No connection. Possible CORS error or network's problems
              </div>
            ) : (
              checkerNamesList.map((checkerName) => (
                <Badge
                  key={checkerName}
                  variant="outline"
                  className={cn("m-0.5", {
                    "border-red-600 cursor-pointer":
                      failedErrorChecks.includes(checkerName),
                    "border-orange-500 cursor-pointer":
                      failedValidationChecks.includes(checkerName),
                  })}
                  onClick={() => handleBadgeClick(checkerName)}
                  data-testid="hc-validator-badge"
                >
                  {checkerName}
                  {failedErrorChecks.includes(checkerName) &&
                    <OctagonAlert className={cn("ml-1 inline-block w-4 h-4 color-red-600")} />
                  }
                  {failedValidationChecks.includes(checkerName) && 
                    <TriangleAlert className={cn("ml-1 inline-block w-4 h-4 color-orange-500")} />
                  }
                </Badge>
              ))
            )}
          </div>
        </div>
        <div className="flex flex-col w-full md:w-1/2 align-center justify-center">
          {isHealthCheckerActive && (
            <div className="flex w-full justify-center align-center">
              {score !== -1 ? (
                score !== 0 && (
                  <div className="flex gap-6">
                    <p>Latency: {latency}</p>
                    <p>Score: {score.toFixed(3)}</p>
                  </div>
                )
              ) : (
                <Loader2 className="h-6 w-6 animate-spin" />
              )}
            </div>
          )}
          <div className="flex w-full items-end justify-center text-center">
            {!isSelected ? (
              <Button
                className="hover:bg-slate-400 rounded w-full max-w-[200px]"
                onClick={() => switchToProvider(providerLink)}
                data-testid="hc-set-api-button"
              >
                Set Main
              </Button>
            ) : (
              <div className="text-green-600" data-testid="hc-selected">
                Selected
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default ProviderCard;
