import { Input } from "./shad/input";
import { useState } from "react";
import { Button } from "./shad/button";

interface ProviderAdditionProps {
  onProviderSubmit: (provider: string) => void;
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
}) => {
  const [providerValue, setProviderValue] = useState<string>("");
  const [error, setError] = useState("");

  const onSubmit = (providerValue: string) => {
    if (!isValidUrl(providerValue)) {
      setError(
        "Please enter a valid URL (must start with http:// or https://)"
      );
      return;
    }
    setError("");
    onProviderSubmit(providerValue.trim());
    setProviderValue("");
  };

  return (
    <div className="flex flex-col justify left">
      <div className="font-semibold">Add Custom Node:</div>
      <div className="text-sm mb-2">Enter a custom Hive node URL.</div>
      <div className="flex w-ful">
        <Input
          value={providerValue}
          autoFocus={true}
          className="focus:bg-white dark:focus:bg-gray-700"
          type="url"
          data-testid="api-address-input"
          placeholder="(e.g., https://example.com)"
          onChange={(e) => setProviderValue(e.target.value)}
        />
        <Button
          disabled={providerValue === ""}
          className="hover:bg-slate-400 ml-2"
          onClick={() => {
            onSubmit(providerValue);
          }}
        >
          Add
        </Button>
      </div>
      {error ? <div className="flex text-red-500">{error}</div> : null}
    </div>
  );
};

export default ProviderAddition;
