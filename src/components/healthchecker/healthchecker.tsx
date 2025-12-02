import { cn } from "./utils.ts";
import { TScoredEndpoint } from "@hiveio/wax";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "./shad/button";
import ProviderCard from "./ProviderCard";
import ProviderAdditionDialog from "./ProviderAddition.tsx";
import ValidationErrorDialog from "./ValidationErrorDialog";
import ConfirmationSwitchDialog from "./ConfirmationSwitchDialog";
import { ValidationErrorDetails, ApiChecker } from "./index.ts";
import { HealthCheckerService } from "./index.ts";
import { Toggle } from "./shad/toggle.tsx";
import { Input } from "./shad/input.tsx";

interface HealthCheckerComponentProps {
  className?: string;
  healthCheckerService: HealthCheckerService;
}

const HealthCheckerComponent: React.FC<HealthCheckerComponentProps> = ({
  className,
  healthCheckerService,
}) => {
  const {
    addProvider,
    removeProvider,
    resetProviders,
    clearValidationError,
    handleChangeOfNode,
    startCheckingProcess,
    stopCheckingProcess,
    evaluateAndSwitch,
    serviceKey,
  } = healthCheckerService;

  const [apiCheckers, setApiCheckers] = useState<ApiChecker[] | undefined>(
    undefined
  );
  const [scoredEndpoints, setScoredEndpoints] = useState<
    TScoredEndpoint[] | undefined
  >(undefined);
  const [nodeAddress, setNodeAddress] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[] | undefined>(undefined);
  const [filter, setFilter] = useState("");
  const [failedChecksByProvider, setFailedChecksByProvider] = useState<
    Map<string, ValidationErrorDetails[]>
  >(new Map());
  const [isActive, setIsActive] = useState<boolean | undefined>(undefined);
  const [switchStatus, setSwitchStatus] = useState<
    "waiting" | "done" | "no_change" | undefined
  >(undefined);

  const [isValidationErrorDialogOpened, setIsValidationErrorDialogOpened] =
    useState<boolean>(false);
  const [selectedValidator, setSelectedValidator] = useState<
    ValidationErrorDetails | undefined
  >(undefined);
  const [isConfirmationSwitchDialogOpened, setIsConfirmationSwitchDialogOpened] =
    useState<boolean>(false);
  const [pendingProviderSwitch, setPendingProviderSwitch] = useState<
    string | undefined
  >(undefined);

  const handleAdditionOfProvider = (provider: string) => {
    addProvider(provider);
  };

  const selectValidator = (providerName: string, checkTitle: string) => {
    const foundValidator = failedChecksByProvider
      ?.get(providerName)
      ?.find((failedCheck) => failedCheck.checkName === checkTitle);
    if (foundValidator) {
      setSelectedValidator(foundValidator);
      setIsValidationErrorDialogOpened(true);
    }
  };

  const checkIfProviderIsValid = (providerLink: string): boolean => {
    const scoredEndpoint = scoredEndpoints?.find(
      (endpoint) => endpoint.endpointUrl === providerLink
    );
    if (!scoredEndpoint) return false;
    const failedChecks = failedChecksByProvider.get(providerLink) || [];
    return (
      scoredEndpoint.score > 0 &&
      (!failedChecks || failedChecks.length === 0)
    )

  }

  const handleSwitchToProvider = (providerLink: string | null) => {
    if (!providerLink) return;
    if (checkIfProviderIsValid(providerLink)) {
      handleChangeOfNode(providerLink);
    } else {
      setPendingProviderSwitch(providerLink);
      setIsConfirmationSwitchDialogOpened(true);
    }
  };

  const handleConfirmProviderSwitch = () => {
    if (pendingProviderSwitch) {
      handleChangeOfNode(pendingProviderSwitch);
      setPendingProviderSwitch(undefined);
      setIsConfirmationSwitchDialogOpened(false)
    }
  };

  const actualizeData = () => {
    const hcData = healthCheckerService.getComponentData();
    if (hcData) {
      setScoredEndpoints(hcData?.scoredEndpoints);
      setApiCheckers(hcData?.apiCheckers);
      setProviders(hcData?.providers);
      setFailedChecksByProvider(hcData.failedChecksByProvider);
      setNodeAddress(hcData?.nodeAddress);
      setIsActive(hcData?.isActive);
      setSwitchStatus(hcData?.switchStatus);
    }
  };

  const changeActivity = () => {
    if (isActive) {
      stopCheckingProcess();
    } else {
      startCheckingProcess();
    }
  };

  useEffect(() => {
    healthCheckerService.addEventListener(`stateChange-${serviceKey}`, () => {
      actualizeData();
    });
    actualizeData();
    return () => {
      healthCheckerService.removeEventListener(
        `stateChange-${serviceKey}`,
        () => {
          actualizeData();
        }
      );
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderProvider = (
    scoredEndpoint: TScoredEndpoint,
    index: number,
    isTop?: boolean
  ) => {
    const { endpointUrl, score, up } = scoredEndpoint;
    let lastLatency: number | null = null;
    if (up && scoredEndpoint.latencies.length) {
      lastLatency =
        scoredEndpoint.latencies[scoredEndpoint.latencies.length - 1];
    }
    if (!providers?.find((customProvider) => customProvider === endpointUrl)) {
      return null;
    }
    return (
      <ProviderCard
        isTop={!!isTop}
        key={endpointUrl}
        providerLink={endpointUrl}
        switchToProvider={handleSwitchToProvider}
        disabled={score === 0}
        latency={lastLatency}
        isSelected={scoredEndpoint.endpointUrl === nodeAddress}
        checkerNamesList={
          apiCheckers?.map((apicChecker) => apicChecker.title) || []
        }
        index={index + 1}
        score={scoredEndpoint.score}
        deleteProvider={removeProvider}
        failedErrorChecks={
          failedChecksByProvider
            .get(endpointUrl)
            ?.filter((failedCheck) => failedCheck.status === "serverError")?.map((failedCheck) => failedCheck.checkName)|| []
        }
        failedValidationChecks={
          failedChecksByProvider
            .get(endpointUrl)
            ?.filter((failedCheck) => failedCheck.status === "validation")?.map((failedCheck) => failedCheck.checkName)|| []
        }
        selectValidator={selectValidator}
        isProviderValid={checkIfProviderIsValid(endpointUrl)}
        isHealthCheckerActive={!!isActive}
      />
    );
  };

  const renderProviders = () => {
    if (!scoredEndpoints || !scoredEndpoints.length)
      return (
        <Loader2 className="ml-2 animate-spin h-8 w-8 justify-self-center mb-4 ..." />
      );

    const filteredEndpoints = filter
      ? scoredEndpoints.filter((endpoint) =>
          endpoint.endpointUrl.toLowerCase().includes(filter.toLowerCase())
        )
      : scoredEndpoints;

    return (
      <>
        {filteredEndpoints
          .sort((a, b) => {
            if (a.endpointUrl === nodeAddress) return -1;
            if (b.endpointUrl === nodeAddress) return 1;
            return 0;
          })
          .map((scoredEndpoint, index) =>
            renderProvider(scoredEndpoint, index)
          )}
      </>
    );
  };

  const renderSwitchStatus = () => {
    if (!switchStatus) return <>Switch to Best</>;
    if (switchStatus === "waiting")
      return (
        <>
          Evaluating{" "}
          {switchStatus === "waiting" && (
            <Loader2 className="animate-spin h-6 w-6 ..." />
          )}
        </>
      );
    if (switchStatus === "done") return <>Endpoint found, switching</>;
    if (switchStatus === "no_change") return <>Already on the best provider</>;
  };

  return (
    <div className={cn(className)}>
      <div className="flex justify-between items-center">
        <h2 className="text-xl text-left">Healthchecker for API servers</h2>
        <div className="flex items-center space-x-2 my-2">
          <Toggle
            checked={!!isActive}
            onClick={changeActivity}
            leftLabel="Continuous Check"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 justify-between my-2 w-full">
        <Button
          variant="outline"
          className="mt-2 order-1 sm:order-2"
          onClick={evaluateAndSwitch}
        >
          {renderSwitchStatus()}
        </Button>

        <div className="flex mt-2 w-full sm:w-1/2 order-2 sm:order-1">
          <Input
            type="text"
            placeholder="Filter by URL…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full"
          />
          {filter && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFilter("")}
              aria-label="Clear filter"
              className="ml-2"
            >
              Clear
            </Button>
          )}
        </div>
      </div>
      {renderProviders()}
      <ProviderAdditionDialog onProviderSubmit={handleAdditionOfProvider} />
      <Button
        variant="outline"
        className="mt-2"
        onClick={resetProviders}
      >
        Restore default API server set
      </Button>
      <ValidationErrorDialog
        isOpened={isValidationErrorDialogOpened}
        onDialogOpenChange={setIsValidationErrorDialogOpened}
        validatorDetails={selectedValidator}
        clearValidationError={clearValidationError}
      />
      <ConfirmationSwitchDialog
        isOpened={isConfirmationSwitchDialogOpened}
        onDialogOpenChange={setIsConfirmationSwitchDialogOpened}
        onConfirm={handleConfirmProviderSwitch}
        providerLink={pendingProviderSwitch}
      />
    </div>
  );
};

export { HealthCheckerComponent };
