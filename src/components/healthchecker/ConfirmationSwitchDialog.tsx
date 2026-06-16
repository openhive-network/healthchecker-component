import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./shad/dialog";
import { Button } from "./shad/button";

interface ConfirmationSwitchDialogProps {
  isOpened: boolean;
  onDialogOpenChange: (isOpened: boolean) => void;
  onConfirm: () => void;
  providerLink?: string;
}

const ConfirmationSwitchDialog: React.FC<ConfirmationSwitchDialogProps> = ({
  isOpened,
  onDialogOpenChange,
  onConfirm,
  providerLink,
}) => {

  return (
    <Dialog open={isOpened} onOpenChange={onDialogOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-md w-full mx-4">
        <DialogHeader>
          <DialogTitle>Confirm Provider Switch</DialogTitle>
        </DialogHeader>
        <div className="text-sm sm:text-base">
          Are you sure you want to switch to unconfirmed{" "}
          <span className="font-semibold break-words">{providerLink}</span>?
        </div>
        <DialogFooter>
          <Button onClick={() => onDialogOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button onClick={onConfirm}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmationSwitchDialog;
