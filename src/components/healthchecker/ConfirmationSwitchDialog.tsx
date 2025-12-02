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
      <DialogContent className={"bg-gray-800 text-white"}>
        <DialogHeader>
          <DialogTitle>Confirm Provider Switch</DialogTitle>
        </DialogHeader>
        <div>
          Are you sure you want to switch to unconfirmed{" "}
          <span className="font-semibold">{providerLink}</span>?
        </div>
        <DialogFooter>
          <Button onClick={() => onDialogOpenChange(false)} variant="outline" className="text-white dark:text-black">
            Cancel
          </Button>
          <Button onClick={onConfirm}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmationSwitchDialog;
