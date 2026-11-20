import { Input } from "./shad/input";
import { useState } from "react";
import { Button } from "./shad/button";
import { DEFAULT_PROVIDER_ADDITION_LABELS, type ProviderAdditionLabels } from "./labels";

interface ProviderAdditionProps {
  onProviderSubmit: (provider: string) => void;
  labels?: ProviderAdditionLabels;
}

const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const hasValidProtocol =
      parsed.protocol === "http:" || parsed.protocol === "https:";
    const hasDomainExtension = /\.[a-z]{2,}$/i.test(parsed.hostname);
    return hasValidProtocol && hasDomainExtension;
  } catch {
    return false;
  }
};

const ProviderAddition: React.FC<ProviderAdditionProps> = ({
  onProviderSubmit,
  labels = DEFAULT_PROVIDER_ADDITION_LABELS,
}) => {
  const [providerValue, setProviderValue] = useState<string>("");
  const [error, setError] = useState("");

  const onSubmit = (providerValue: string) => {
    if (!isValidUrl(providerValue)) {
      setError(labels.addNodeInvalidUrl);
      return;
    }
    setError("");
    onProviderSubmit(providerValue.trim());
    setProviderValue("");
  };

  return (
    <div className="flex flex-col justify left">
      <div className="font-semibold">{labels.addNodeTitle}</div>
      <div className="text-sm mb-2">{labels.addNodeHint}</div>
      <div className="flex w-ful">
        <Input
          value={providerValue}
          autoFocus={true}
          className="focus:bg-white dark:focus:bg-gray-700"
          type="url"
          data-testid="api-address-input"
          placeholder={labels.addNodePlaceholder}
          onChange={(e) => setProviderValue(e.target.value)}
        />
        <Button
          disabled={providerValue === ""}
          className="hover:bg-slate-400 ml-2"
          onClick={() => {
            onSubmit(providerValue);
          }}
        >
          {labels.addNodeButton}
        </Button>
      </div>
      {error ? <div className="flex text-red-500">{error}</div> : null}
    </div>
  );
};

export default ProviderAddition;
