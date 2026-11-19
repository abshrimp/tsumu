import type { ReactNode } from "react";

/** Icon-led title shared by dialogs across the editor and home screen. */
export default function ModalHeading({ icon, children, id }: {
  icon: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="modal-heading">
      <span className="modal-heading-icon" aria-hidden="true">{icon}</span>
      <div className="modal-heading-copy"><h2 id={id}>{children}</h2></div>
    </div>
  );
}
