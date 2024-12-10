
import "./style.css";
import Button from "../Button";

interface InputProps {
  onClick: (action: number) => void;
  onUpdate: (value: number, action: number) => void;
  text: string;
  action: number;
  amount: number;
  placeholder:string
}

const Action = ({
  onClick,
  onUpdate,
  text,
  action,
  placeholder,
}: InputProps) => {
 

  return (
    <div style={{ width: "300", padding: "10px" }} className="flex">
     
      <input
        id="prompt"
        className="input"
        placeholder={placeholder}
        type="number"
        onChange={(e) => onUpdate(+e.target.value, action)}
        style={{width:'200px',marginBottom:'20px'}}
      />

      <Button onClick={() => onClick(action)}>
        {text}
      </Button>
    </div>
  );
};

export default Action;
