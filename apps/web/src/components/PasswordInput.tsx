import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordInput(props: PasswordInputProps) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const label = t(isVisible ? "common.hideCredential" : "common.showCredential");

  return (
    <div className="password-input-control">
      <input {...props} type={isVisible ? "text" : "password"} />
      <button
        type="button"
        className="password-visibility-btn"
        aria-controls={props.id}
        aria-label={label}
        aria-pressed={isVisible}
        title={label}
        onClick={() => setIsVisible((current) => !current)}
      >
        {isVisible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
