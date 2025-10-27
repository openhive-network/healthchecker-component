import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from "./shad/dialog";
import { Button } from "./shad/button";
import { ValidationErrorDetails } from "./HealthCheckerService";
// import { ValidationErrorDetails } from "@/services/HealthCheckerService"; 

interface ValidationErrorDialogProps {
  isOpened: boolean;
  onDialogOpenChange: (isOpened: boolean) => void;
  validatorDetails?: ValidationErrorDetails;
  clearValidationError: (providerName: string, checkerName: string) => void;
}

const ValidationErrorDialog: React.FC<ValidationErrorDialogProps> = ({
    isOpened,
    validatorDetails,
    onDialogOpenChange,
    clearValidationError
}) => {

  const handleErrorClearClick = () => {
    if (validatorDetails?.providerName && validatorDetails?.checkName) {
      clearValidationError(validatorDetails?.providerName, validatorDetails?.checkName);
      onDialogOpenChange(false);
    }
  }

  const displayPrettyJSON = () => {
    return typeof validatorDetails?.params === "string" ? JSON.stringify(JSON.parse(validatorDetails?.params), null, 2) : null;
  }

  return (
    <Dialog open={isOpened} onOpenChange={onDialogOpenChange}>
      <DialogContent className={"bg-gray-800 text-white"}>
        <DialogHeader><DialogTitle>{validatorDetails?.checkName} validator error</DialogTitle></DialogHeader>
        <div>Message:</div>
        <div>{validatorDetails?.message}</div>
        <div>Path:</div>
        <pre>{validatorDetails?.paths.join("/")}</pre>
        {validatorDetails?.params && <>
          <div>Params:</div>
          <pre>{displayPrettyJSON()}</pre>
        </>}
      <DialogFooter>
        <Button onClick={handleErrorClearClick}>Clear error</Button>
      </DialogFooter>
      </DialogContent>
    </Dialog>
  )
};

export default ValidationErrorDialog;
