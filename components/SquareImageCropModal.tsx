import React from "react";

type Props = {
  visible: boolean;
  imageSrc: string;
  onCancel: () => void;
  onSave: (croppedUri: string) => void;
};

/** Native stub — web uses SquareImageCropModal.web.tsx */
export default function SquareImageCropModal(_props: Props) {
  return null;
}
