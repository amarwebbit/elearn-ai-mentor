"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState, useTransition } from "react";
import { create, all } from "mathjs";
import { MathText } from "@/components/math-text";

type ExamConfig = {
  id: string;
  title: string;
  description: string | null;
  total_questions: number;
  duration_minutes: number;
  total_marks: number;
  marks_per_correct: number;
  marks_per_wrong: number;
  marks_per_unattempted: number;
  max_violations: number;
  fullscreen_required: boolean;
  calculator_enabled: boolean;
  scheduled_start_at?: string | null;
  feedback_enabled?: boolean;
  feedback_mandatory?: boolean;
  feedback_template?: Record<string, unknown> | null;
  unsaved_answer_warning?: boolean;
};

type ExamSession = {
  id: string;
  student_id: string;
  exam_id: string;
  status: "active" | "completed" | "auto_submitted" | "expired";
  violation_count: number;
  max_violations: number;
  started_at: string | null;
  allocated_duration: number | null;
};

type ExamQuestion = {
  id: number;
  displayNumber: number;
  question_text: string;
  question_type: "mcq" | "msq" | "numerical";
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  option_d?: string | null;
  marks: number;
  subject?: string | null;
  topic?: string | null;
  image_url?: string | null;
};

type StudentProfile = {
  id: string;
  name: string;
  roll_number: string;
  email: string;
  branch: string;
  section: string;
};

type ResponseState = {
  selected: string | string[] | null;
  markedForReview: boolean;
  visited: boolean;
  firstVisitedAt: string | null;
  timeSpent: number;
  answerChangeCount: number;
};

type SubmissionDetails = {
  studentName: string;
  rollNumber: string;
  email: string;
  submittedAt: string;
  examTitle: string;
};

type Stage = "loading" | "register" | "instructions" | "countdown" | "exam" | "submitted" | "feedback" | "done" | "completed";

type FeedbackState = {
  difficulty: number;
  ui: number;
  calculator: number;
  overall: number;
  recommend: number;
  issues: string;
  suggestions: string;
};

const math = create(all, { number: "number", precision: 14 });

/* function getViolationWarning(type: ViolationType, count: number) {
  if (type === "fullscreen") {
    return {
      title: "⚠️ WARNING: Violation Detected!",
      message: "⚠️ Warning: You exited full screen. Return to full screen within 5 seconds or your exam will be auto-submitted.",
      count
    };
  }
  if (type === "visibility" || type === "blur") {
    return {
      title: "⚠️ WARNING: Violation Detected!",
      message: `⚠️ Tab switch detected! Return to the exam within 5 seconds or your exam will be auto-submitted.`,
      count
    };
  }
  if (type === "devtools") {
    return {
      title: "⚠️ WARNING: Violation Detected!",
      message: "⚠️ Developer tools are not allowed. Return to full screen within 5 seconds or your exam will be auto-submitted.",
      count
    };
  }
  if (type === "printscreen") {
    return {
      title: "⚠️ WARNING: Violation Detected!",
      message: "⚠️ Screenshot attempt detected. Return to full screen within 5 seconds or your exam will be auto-submitted.",
      count
    };
  }
  return {
    title: "⚠️ WARNING: Violation Detected!",
    message: `⚠️ Security violation detected. Return to full screen within 5 seconds or your exam will be auto-submitted.`,
    count
  };
}
*/

type CalculatorUpdate = {
  expressionLine: string;
  resultLine: string;
  mode: "DEG" | "RAD";
  hasMemory: boolean;
};

class GateCalculator {
  private expression = "";
  private input = "";
  private lastExpression = "";
  private lastResult = "0";
  private justEvaluated = false;
  private pendingLogBase: string | null = null;
  memory = 0;
  hasMemory = false;
  angleMode: "DEG" | "RAD" = "DEG";
  private readonly onUpdate: (payload: CalculatorUpdate) => void;

  constructor(onUpdate: (payload: CalculatorUpdate) => void) {
    this.onUpdate = onUpdate;
    this.emit();
  }

  private emit() {
    const rawExpression = this.justEvaluated && this.lastExpression
      ? this.lastExpression
      : `${this.expression}${this.input}`.trim();
    const expressionLine = this.formatExpression(rawExpression);
    const rawResult = this.input || (this.justEvaluated ? this.lastResult : "0");
    const resultLine = this.formatExpression(rawResult);
    this.onUpdate({
      expressionLine: expressionLine || "0",
      resultLine: resultLine || "0",
      mode: this.angleMode,
      hasMemory: this.hasMemory
    });
  }

  private formatExpression(expression: string) {
    if (!expression) {
      return "";
    }
    return expression
      .replace(/\*/g, "×")
      .replace(/\//g, "÷")
      .replace(/\-/g, "−");
  }

  private resetIfJustEvaluated() {
    if (!this.justEvaluated) {
      return;
    }
    this.expression = "";
    this.input = "";
    this.lastExpression = "";
    this.justEvaluated = false;
  }

  private commitInput() {
    if (!this.input) {
      return;
    }
    this.expression += this.input;
    this.input = "";
  }

  private ensureExpressionStart() {
    if (!this.expression && !this.input && this.lastResult) {
      this.input = this.lastResult;
    }
  }

  private buildScope() {
    const toRad = (value: number) => value * (Math.PI / 180);
    const toDeg = (value: number) => (value * 180) / Math.PI;
    const degMode = this.angleMode === "DEG";
    return {
      sin: (value: number) => Math.sin(degMode ? toRad(value) : value),
      cos: (value: number) => Math.cos(degMode ? toRad(value) : value),
      tan: (value: number) => Math.tan(degMode ? toRad(value) : value),
      asin: (value: number) => (degMode ? toDeg(Math.asin(value)) : Math.asin(value)),
      acos: (value: number) => (degMode ? toDeg(Math.acos(value)) : Math.acos(value)),
      atan: (value: number) => (degMode ? toDeg(Math.atan(value)) : Math.atan(value))
    };
  }

  private formatResult(result: unknown) {
    if (typeof result === "number") {
      if (!Number.isFinite(result)) {
        throw new Error("Invalid result");
      }
      if (Math.abs(result) > 1e308 || (Math.abs(result) > 0 && Math.abs(result) < 1e-323)) {
        throw new Error("Result out of range");
      }
      return math.format(result, { precision: 14 });
    }
    if (typeof result === "object" && result && "re" in result && "im" in result) {
      return math.format(result as { re: number; im: number }, { precision: 14 });
    }
    return String(result);
  }

  private closeUnbalancedParens(expression: string) {
    const open = (expression.match(/\(/g) ?? []).length;
    const close = (expression.match(/\)/g) ?? []).length;
    if (open <= close) {
      return expression;
    }
    return `${expression}${")".repeat(open - close)}`;
  }

  inputDigit(digit: string) {
    this.resetIfJustEvaluated();
    if (this.input === "0") {
      this.input = digit;
    } else {
      this.input += digit;
    }
    this.emit();
  }

  inputDot() {
    this.resetIfJustEvaluated();
    if (!this.input) {
      this.input = "0.";
    } else if (!this.input.includes(".")) {
      this.input += ".";
    }
    this.emit();
  }

  inputOperator(op: string) {
    this.ensureExpressionStart();
    if (op === "mod" && this.input && this.input.replace(/\D/g, "").length >= 15) {
      alert("Warning: MOD operation not precise for numbers with 15+ digits");
    }
    this.commitInput();
    if (!this.expression && this.lastResult) {
      this.expression = this.lastResult;
    }
    if (!this.expression) {
      return;
    }
    const trimmed = this.expression.trim();
    if (/[+\-*/^]$/.test(trimmed)) {
      this.expression = `${trimmed.slice(0, -1)}${op} `;
    } else if (trimmed.endsWith("mod")) {
      this.expression = `${trimmed.slice(0, -3)}${op} `;
    } else {
      this.expression = `${this.expression} ${op} `;
    }
    this.justEvaluated = false;
    this.emit();
  }

  inputParen(paren: "(" | ")") {
    this.ensureExpressionStart();
    this.commitInput();
    this.expression += paren;
    this.justEvaluated = false;
    this.emit();
  }

  inputFunction(fn: string) {
    this.resetIfJustEvaluated();
    if (this.input) {
      this.input = `${fn}(${this.input})`;
    } else {
      this.expression += `${fn}(`;
    }
    this.emit();
  }

  inputLogBase() {
    this.resetIfJustEvaluated();
    const base = this.input || this.lastResult || "0";
    this.pendingLogBase = base;
    this.expression = `log(${base},`;
    this.input = "";
    this.emit();
  }

  inputUnaryTemplate(template: string) {
    this.resetIfJustEvaluated();
    const target = this.input || this.lastResult || "0";
    this.input = template.replace("{x}", target);
    this.emit();
  }

  inputFactorial() {
    this.resetIfJustEvaluated();
    const target = this.input || this.lastResult || "0";
    const numeric = Number(target);
    if (!Number.isFinite(numeric) || numeric < 0) {
      alert("Factorial not defined for negative numbers");
      return;
    }
    if (!Number.isInteger(numeric)) {
      alert("Factorial requires an integer input");
      return;
    }
    if (numeric > 170) {
      alert("Factorial result exceeds supported range");
      return;
    }
    this.input = `factorial(${target})`;
    this.emit();
  }

  inputConstant(value: string) {
    this.resetIfJustEvaluated();
    if (!this.input) {
      this.input = value;
    } else {
      this.input = `${this.input}*${value}`;
    }
    this.emit();
  }

  inputImaginary() {
    this.resetIfJustEvaluated();
    if (!this.input) {
      this.input = "i";
    } else if (!this.input.endsWith("i")) {
      this.input += "i";
    }
    this.emit();
  }

  toggleSign() {
    this.resetIfJustEvaluated();
    if (!this.input) {
      this.input = "-";
    } else if (this.input.startsWith("-")) {
      this.input = this.input.slice(1);
    } else {
      this.input = `-${this.input}`;
    }
    this.emit();
  }

  percent() {
    this.resetIfJustEvaluated();
    if (!this.input) {
      return;
    }
    this.input = `(${this.input})/100`;
    this.emit();
  }

  inputExp() {
    this.resetIfJustEvaluated();
    if (!this.input) {
      this.input = "1e";
    } else if (!this.input.toLowerCase().includes("e")) {
      this.input = `${this.input}e`;
    }
    this.emit();
  }

  backspace() {
    this.resetIfJustEvaluated();
    if (this.input) {
      this.input = this.input.slice(0, -1);
      this.emit();
      return;
    }
    if (this.expression) {
      this.expression = this.expression.slice(0, -1);
      this.emit();
    }
  }

  clearAll() {
    this.expression = "";
    this.input = "";
    this.lastExpression = "";
    this.justEvaluated = false;
    this.lastResult = "0";
    this.emit();
  }

  evaluate() {
    const rawExpression = `${this.expression}${this.input}`.trim();
    if (!rawExpression) {
      return;
    }
    if (this.pendingLogBase) {
      const argument = this.input || this.lastResult || "0";
      const expression = `log(${argument},${this.pendingLogBase})`;
      try {
        const result = math.evaluate(expression, this.buildScope());
        const formatted = this.formatResult(result);
        this.lastExpression = expression;
        this.lastResult = formatted;
        this.expression = "";
        this.input = formatted;
        this.justEvaluated = true;
        this.pendingLogBase = null;
        this.emit();
      } catch (error) {
        console.error("calculator error", error);
        this.input = "Error";
        this.pendingLogBase = null;
        this.emit();
      }
      return;
    }
    const expression = this.closeUnbalancedParens(rawExpression);
    try {
      const result = math.evaluate(expression, this.buildScope());
      const formatted = this.formatResult(result);
      this.lastExpression = expression;
      this.lastResult = formatted;
      this.expression = "";
      this.input = formatted;
      this.justEvaluated = true;
      this.emit();
    } catch (error) {
      console.error("calculator error", error);
      this.input = "Error";
      this.emit();
    }
  }

  toggleAngleMode() {
    this.angleMode = this.angleMode === "DEG" ? "RAD" : "DEG";
    this.emit();
  }

  setAngleMode(mode: "DEG" | "RAD") {
    this.angleMode = mode;
    this.emit();
  }

  memoryClear() {
    this.memory = 0;
    this.hasMemory = false;
    this.emit();
  }

  memoryRecall() {
    this.input = String(this.memory);
    this.emit();
  }

  memoryStore() {
    const value = math.evaluate(this.input || this.lastResult || "0", this.buildScope());
    if (typeof value === "number") {
      this.memory = value;
      this.hasMemory = this.memory !== 0;
    }
    this.emit();
  }

  memoryAdd() {
    const value = math.evaluate(this.input || this.lastResult || "0", this.buildScope());
    if (typeof value === "number") {
      this.memory += value;
      this.hasMemory = this.memory !== 0;
    }
    this.emit();
  }

  memorySubtract() {
    const value = math.evaluate(this.input || this.lastResult || "0", this.buildScope());
    if (typeof value === "number") {
      this.memory -= value;
      this.hasMemory = this.memory !== 0;
    }
    this.emit();
  }
}

export function PilotExam({ testId }: { testId: string }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [exam, setExam] = useState<ExamConfig | null>(null);
  const [session, setSession] = useState<ExamSession | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [responses, setResponses] = useState<Record<number, ResponseState>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [fullscreenBlocked, setFullscreenBlocked] = useState<string | null>(null);
  const [fullscreenOverlay, setFullscreenOverlay] = useState(false);
  const [violationModal, setViolationModal] = useState<{
    title: string;
    message: string;
    count: number;
    max: number;
    requiresFullscreen?: boolean;
    autoSubmit?: boolean;
  } | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<number | null>(null);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [draftSelections, setDraftSelections] = useState<Record<number, string | string[] | null>>({});
  const [timerAlert, setTimerAlert] = useState<string | null>(null);
  const [submissionNotice, setSubmissionNotice] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [submissionDetails, setSubmissionDetails] = useState<SubmissionDetails | null>(null);
  const [instructionDelay, setInstructionDelay] = useState(0);
  const [instructionReady, setInstructionReady] = useState(true);
  const [instructionAgreed, setInstructionAgreed] = useState(false);
  const [scheduleCountdown, setScheduleCountdown] = useState<number | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [autoSubmitComplete, setAutoSubmitComplete] = useState(false);
  const [violationCountdown, setViolationCountdown] = useState<number | null>(null);
  const [sectionSwitchOpen, setSectionSwitchOpen] = useState(false);
  const [pendingSectionIndex, setPendingSectionIndex] = useState<number | null>(null);
  const [pendingSectionLabel, setPendingSectionLabel] = useState<string | null>(null);
  const [sectionInfoOpen, setSectionInfoOpen] = useState(false);
  const [sectionInfoLabel, setSectionInfoLabel] = useState<string | null>(null);
  const scheduleRef = useRef<number | null>(null);
  const [registerForm, setRegisterForm] = useState({
    fullName: "",
    rollNumber: "",
    email: "",
    branch: "CSE",
    section: "A"
  });
  const [feedback, setFeedback] = useState<FeedbackState>({
    difficulty: 0,
    ui: 0,
    calculator: 0,
    overall: 0,
    recommend: 0,
    issues: "",
    suggestions: ""
  });
  const [calculatorDisplay, setCalculatorDisplay] = useState("0");
  const [calculatorExpression, setCalculatorExpression] = useState("0");
  const [calculatorMode, setCalculatorMode] = useState<"DEG" | "RAD">("DEG");
  const [calculatorHasMemory, setCalculatorHasMemory] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [calculatorMinimized, setCalculatorMinimized] = useState(false);
  const [calculatorInfoOpen, setCalculatorInfoOpen] = useState(false);
  const [calculatorPosition, setCalculatorPosition] = useState<{ x: number; y: number } | null>(null);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  const timerRef = useRef<number | null>(null);
  const currentQuestionStartRef = useRef<number | null>(null);
  const calculatorRef = useRef<GateCalculator | null>(null);
  const responsesRef = useRef<Record<number, ResponseState>>({});
  const responseCacheTimerRef = useRef<number | null>(null);
  const fullscreenCheckRef = useRef<number | null>(null);
  const timerAlertRef = useRef({ fifteen: false, five: false, one: false });
  const autoSaveRef = useRef<number | null>(null);
  const wasFullscreenRef = useRef(false);
  const violationBusyRef = useRef(false);
  const violationTimerRef = useRef<number | null>(null);
  const submitRef = useRef<(mode: string) => void>(() => {});
  const calculatorDragRef = useRef({ active: false, offsetX: 0, offsetY: 0 });

  const currentQuestion = questions[currentIndex];
  const currentDisplayNumber = currentQuestion?.displayNumber ?? 1;
  const deferredResponses = useDeferredValue(responses);
  const sectionLabels = getSectionLabels(questions);
  const hasSections = sectionLabels.length > 1;
  const resolvedSectionLabel = activeSection ?? (sectionLabels[0] ?? "General");

  const buildViolationMessage = useCallback((type: string, count: number, max: number) => {
    const base = `Violation ${count} of ${max}`;
    switch (type) {
      case "fullscreen":
        return {
          title: "Fullscreen Exit Detected",
          message: `${base}. You exited fullscreen. Return to fullscreen immediately to continue the exam.`
        };
      case "visibility":
      case "blur":
        return {
          title: "Tab/Window Switch Detected",
          message: `${base}. You attempted to switch tabs or applications. Stay on the exam screen.`
        };
      case "printscreen":
        return {
          title: "Screenshot Attempt Detected",
          message: `${base}. Screenshots are not allowed during the exam.`
        };
      default:
        return {
          title: "Security Warning",
          message: `${base}. This action is not allowed during the exam.`
        };
    }
  }, []);

  const triggerViolation = useCallback(
    async (type: "fullscreen" | "blur" | "visibility" | "printscreen" | "other") => {
      const secureStages = new Set(["countdown", "exam"]);
      if (!secureStages.has(stage) || violationBusyRef.current) {
        return;
      }
      violationBusyRef.current = true;
      try {
        const response = await fetch("/api/exam/violation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, questionNumber: currentDisplayNumber })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Unable to record violation.");
        }
        const count = Number(payload?.violationCount ?? 1);
        const max = 3;
        const shouldSubmit = count >= max || Boolean(payload?.shouldSubmit ?? false);
        const message = buildViolationMessage(type, count, max);
        setViolationModal({
          title: message.title,
          message: message.message,
          count,
          max,
          requiresFullscreen: type === "fullscreen",
          autoSubmit: shouldSubmit
        });
        if (shouldSubmit) {
          setAutoSubmitComplete(false);
          setSubmissionNotice("Your exam has been auto-submitted due to multiple violations.");
          window.setTimeout(() => submitRef.current?.("auto_violation"), 800);
        }
      } catch (error) {
        console.error("violation trigger failed", error);
      } finally {
        violationBusyRef.current = false;
      }
    },
    [buildViolationMessage, currentDisplayNumber, stage]
  );

  const clearViolationCountdown = useCallback(() => {
    if (violationTimerRef.current) {
      window.clearInterval(violationTimerRef.current);
      violationTimerRef.current = null;
    }
    setViolationCountdown(null);
  }, []);

  useEffect(() => {
    clearViolationCountdown();
    if (!violationModal || violationModal.autoSubmit) {
      return;
    }
    let remaining = 15;
    setViolationCountdown(remaining);
    violationTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setViolationCountdown(remaining);
      if (remaining <= 0) {
        clearViolationCountdown();
        setAutoSubmitComplete(false);
        setSubmissionNotice("Your exam has been auto-submitted due to a security violation.");
        setViolationModal((current) => (current ? { ...current, autoSubmit: true } : current));
        submitRef.current?.("auto_violation");
      }
    }, 1000);
    return () => {
      clearViolationCountdown();
    };
  }, [clearViolationCountdown, violationModal]);

  const allowKeyboardInput = useCallback(
    (event: KeyboardEvent, currentStage: Stage) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return false;
      }
      if (target.classList.contains("nat-input-field")) {
        const allowed = [
          "0",
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          ".",
          "-",
          "Backspace",
          "Delete",
          "Tab",
          "ArrowLeft",
          "ArrowRight"
        ];
        return allowed.includes(event.key);
      }
      if (currentStage === "feedback") {
        return target.tagName === "TEXTAREA" || target.tagName === "INPUT";
      }
      return false;
    },
    []
  );

  useEffect(() => {
    responsesRef.current = responses;
  }, [responses]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let ignore = false;
    async function bootstrap() {
      setStage("loading");
      try {
        const response = await fetch(`/api/exam/session?examId=${encodeURIComponent(testId)}`, {
          credentials: "include"
        });
        const payload = await response.json();
        if (ignore) {
          return;
        }
        if (payload.status === "none") {
          setStage("register");
          return;
        }
        if (payload.status === "completed") {
          setStudent(payload.student);
          setExam(payload.exam);
          setSession(payload.session);
          setStage("completed");
          return;
        }
        if (payload.status === "active") {
          setStudent(payload.student);
          setExam(payload.exam);
          setSession(payload.session);
          if (payload.questions?.length) {
            const hydrated = buildResponseState(payload.questions, payload.responses ?? []);
            const cached = !payload.responses?.length ? readCachedResponses() : null;
            setResponses(cached ?? hydrated.responses);
            setQuestions(payload.questions);
            setCurrentIndex(0);
            setRemainingSeconds(calculateRemainingSeconds(payload.session, payload.exam));
            if (payload.session.started_at) {
              setStage("exam");
            } else {
              setStage("instructions");
            }
          } else {
            setStage("instructions");
          }
          return;
        }
        setStage("register");
      } catch (error) {
        console.error("exam bootstrap failed", error);
        setStage("register");
      }
    }

    void bootstrap();
    return () => {
      ignore = true;
    };
  }, [testId]);

  useEffect(() => {
    if (stage !== "instructions") {
      return;
    }
    setInstructionDelay(0);
    setInstructionReady(true);
  }, [stage]);

  useEffect(() => {
    if (stage !== "exam" || !exam) {
      stopTimer();
      return;
    }
    startTimer();
    return () => stopTimer();
  }, [stage, exam?.id]);

  useEffect(() => {
    const secureStages = new Set(["countdown", "exam"]);
    if (!secureStages.has(stage) || !exam?.fullscreen_required) {
      setFullscreenBlocked(null);
      setFullscreenOverlay(false);
      if (fullscreenCheckRef.current) {
        window.clearInterval(fullscreenCheckRef.current);
        fullscreenCheckRef.current = null;
      }
      return;
    }

    const isDesktop = isDesktopDevice();
    if (!isDesktop) {
      document.documentElement.style.height = "100%";
      document.body.style.height = "100%";
      document.body.style.overflow = "hidden";
      return;
    }

    if (!document.fullscreenEnabled) {
      setFullscreenBlocked("Your browser does not support fullscreen mode. Please use Google Chrome (latest version) on a desktop/laptop.");
      return;
    }

    const requestFullscreen = async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        }
        setFullscreenBlocked(null);
      } catch {
        setFullscreenBlocked("Fullscreen permission was blocked. Please allow fullscreen to continue the exam.");
      }
    };

    void requestFullscreen();

    if (fullscreenCheckRef.current) {
      window.clearInterval(fullscreenCheckRef.current);
    }
    const handleFullscreenChange = () => {
      const isFull = Boolean(document.fullscreenElement);
      if (!isFull && wasFullscreenRef.current) {
        void triggerViolation("fullscreen");
      }
      wasFullscreenRef.current = isFull;
      setFullscreenOverlay(!isFull);
    };

    wasFullscreenRef.current = Boolean(document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    fullscreenCheckRef.current = window.setInterval(() => {
      handleFullscreenChange();
    }, 1000);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (fullscreenCheckRef.current) {
        window.clearInterval(fullscreenCheckRef.current);
        fullscreenCheckRef.current = null;
      }
    };
  }, [stage, exam?.fullscreen_required, triggerViolation]);

  useEffect(() => {
    if (stage !== "done") {
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    }
  }, [stage]);

  useEffect(() => {
    const secureStages = new Set(["countdown", "exam"]);
    if (!secureStages.has(stage)) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (allowKeyboardInput(event, stage)) {
        return;
      }
      if (event.key === "PrintScreen") {
        void triggerViolation("printscreen");
      }
      if (event.key === "Escape" || event.key === "F11") {
        void triggerViolation("fullscreen");
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const preventDefault = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", handleKey, true);
    document.addEventListener("keypress", handleKey, true);
    document.addEventListener("keyup", handleKey, true);
    document.addEventListener("contextmenu", preventDefault, true);
    document.addEventListener("copy", preventDefault, true);
    document.addEventListener("cut", preventDefault, true);
    document.addEventListener("paste", preventDefault, true);
    document.addEventListener("dragstart", preventDefault, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("keypress", handleKey, true);
      document.removeEventListener("keyup", handleKey, true);
      document.removeEventListener("contextmenu", preventDefault, true);
      document.removeEventListener("copy", preventDefault, true);
      document.removeEventListener("cut", preventDefault, true);
      document.removeEventListener("paste", preventDefault, true);
      document.removeEventListener("dragstart", preventDefault, true);
    };
  }, [stage]);

  useEffect(() => {
    const secureStages = new Set(["countdown", "exam"]);
    if (!secureStages.has(stage)) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "You are in an active exam. Please submit before leaving.";
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [stage]);

  useEffect(() => {
    const secureStages = new Set(["countdown", "exam"]);
    if (!secureStages.has(stage)) {
      return;
    }
    const handleBlur = () => {
      void triggerViolation("blur");
    };
    const handleVisibility = () => {
      if (document.hidden) {
        void triggerViolation("visibility");
      }
    };
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [stage, triggerViolation]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (stage !== "exam") {
      if (autoSaveRef.current) {
        window.clearInterval(autoSaveRef.current);
        autoSaveRef.current = null;
      }
      return;
    }
    if (autoSaveRef.current) {
      window.clearInterval(autoSaveRef.current);
    }
    autoSaveRef.current = window.setInterval(() => {
      const jitter = Math.floor(Math.random() * 2000);
      window.setTimeout(() => {
        void handleAutoSave();
      }, jitter);
    }, 60000);
    return () => {
      if (autoSaveRef.current) {
        window.clearInterval(autoSaveRef.current);
        autoSaveRef.current = null;
      }
    };
  }, [stage]);

  useEffect(() => {
    if (!calculatorRef.current) {
      calculatorRef.current = new GateCalculator((payload) => {
        setCalculatorExpression(payload.expressionLine);
        setCalculatorDisplay(payload.resultLine);
        setCalculatorMode(payload.mode);
        setCalculatorHasMemory(payload.hasMemory);
      });
    }
  }, []);

  useEffect(() => {
    if (!calculatorOpen || calculatorPosition) {
      return;
    }
    const initialX = Math.max(24, window.innerWidth - 520);
    const initialY = 140;
    setCalculatorPosition({ x: initialX, y: initialY });
  }, [calculatorOpen, calculatorPosition]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!calculatorDragRef.current.active) {
        return;
      }
      const nextX = Math.max(12, event.clientX - calculatorDragRef.current.offsetX);
      const nextY = Math.max(12, event.clientY - calculatorDragRef.current.offsetY);
      setCalculatorPosition({ x: nextX, y: nextY });
    };
    const handleUp = () => {
      calculatorDragRef.current.active = false;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    if (stage !== "exam") {
      return;
    }
    const pushState = () => {
      window.history.pushState(null, "", window.location.href);
    };
    const preventBack = () => {
      pushState();
    };
    pushState();
    window.addEventListener("popstate", preventBack);
    return () => window.removeEventListener("popstate", preventBack);
  }, [stage]);

  useEffect(() => {
    if (stage !== "exam") {
      return;
    }
    if (responseCacheTimerRef.current) {
      window.clearTimeout(responseCacheTimerRef.current);
    }
    responseCacheTimerRef.current = window.setTimeout(() => {
      try {
        const payload = JSON.stringify({ responses: responsesRef.current, updatedAt: Date.now() });
        window.localStorage.setItem(`trinetra_exam_${testId}`, payload);
      } catch {
        // ignore storage errors
      } finally {
        responseCacheTimerRef.current = null;
      }
    }, 1200);
    return () => {
      if (responseCacheTimerRef.current) {
        window.clearTimeout(responseCacheTimerRef.current);
        responseCacheTimerRef.current = null;
      }
    };
  }, [responses, stage, testId]);

  useEffect(() => {
    if (stage !== "submitted") {
      return;
    }
    const pushState = () => {
      window.history.pushState(null, "", window.location.href);
    };
    const preventBack = () => {
      pushState();
    };
    pushState();
    window.addEventListener("popstate", preventBack);
    return () => window.removeEventListener("popstate", preventBack);
  }, [stage]);


  const updateResponse = useCallback(
    (displayNumber: number, updater: (current: ResponseState) => ResponseState) => {
      setResponses((current) => {
        const existing = current[displayNumber] ?? {
          selected: null,
          markedForReview: false,
          visited: true,
          firstVisitedAt: new Date().toISOString(),
          timeSpent: 0,
          answerChangeCount: 0
        };
        const updated = updater(existing);
        return { ...current, [displayNumber]: updated };
      });
    },
    []
  );

  useEffect(() => {
    if (stage !== "exam" || !currentQuestion) {
      return;
    }
    updateResponse(currentDisplayNumber, (current) => ({
      ...current,
      visited: true,
      firstVisitedAt: current.firstVisitedAt ?? new Date().toISOString()
    }));
  }, [stage, currentQuestion?.displayNumber, updateResponse, currentDisplayNumber, currentQuestion]);

  useEffect(() => {
    if (stage !== "exam") {
      return;
    }
    if (!currentQuestionStartRef.current) {
      currentQuestionStartRef.current = Date.now();
    }
  }, [stage]);

  useEffect(() => {
    if (stage === "exam") {
      timerAlertRef.current = { fifteen: false, five: false, one: false };
    }
  }, [stage]);

  useEffect(() => {
    if (!questions.length) {
      return;
    }
    const sections = getSectionLabels(questions);
    if (sections.length && !activeSection) {
      setActiveSection(sections[0]);
    }
  }, [questions, activeSection]);

  const getDraftSelection = useCallback(
    (displayNumber: number) =>
      Object.prototype.hasOwnProperty.call(draftSelections, displayNumber) ? draftSelections[displayNumber] : undefined,
    [draftSelections]
  );

  const resolveDisplayedSelection = useCallback(
    (displayNumber: number) => {
      const draft = getDraftSelection(displayNumber);
      if (draft !== undefined) {
        return draft ?? null;
      }
      return responses[displayNumber]?.selected ?? null;
    },
    [getDraftSelection, responses]
  );

  const hasUnsavedSelection = useCallback(
    (displayNumber: number) => {
      const draft = getDraftSelection(displayNumber);
      if (draft === undefined) {
        return false;
      }
      const saved = responses[displayNumber]?.selected ?? null;
      return serializeSelected(draft) !== serializeSelected(saved);
    },
    [getDraftSelection, responses]
  );

  const discardDraftSelection = useCallback((displayNumber: number) => {
    setDraftSelections((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, displayNumber)) {
        return current;
      }
      const next = { ...current };
      delete next[displayNumber];
      return next;
    });
  }, []);

  const handleSelectOption = (displayNumber: number, value: string | string[] | null) => {
    setDraftSelections((current) => ({ ...current, [displayNumber]: value }));
  };

  const handleMarkForReview = (displayNumber: number, marked: boolean) => {
    updateResponse(displayNumber, (current) => ({ ...current, markedForReview: marked }));
  };

  const handleClearResponse = () => {
    const existing = responses[currentDisplayNumber] ?? {
      selected: null,
      markedForReview: false,
      visited: true,
      firstVisitedAt: new Date().toISOString(),
      timeSpent: 0,
      answerChangeCount: 0
    };
    const updatedState = {
      ...existing,
      selected: null,
      answerChangeCount: existing.answerChangeCount + (existing.selected ? 1 : 0)
    };
    updateResponse(currentDisplayNumber, () => updatedState);
    discardDraftSelection(currentDisplayNumber);
    void persistResponse(currentDisplayNumber, updatedState);
  };

  const updateTimeSpent = useCallback(
    (displayNumber: number) => {
      if (!currentQuestionStartRef.current) {
        currentQuestionStartRef.current = Date.now();
        return;
      }
      const now = Date.now();
      const elapsed = Math.max(0, Math.floor((now - currentQuestionStartRef.current) / 1000));
      if (elapsed > 0) {
        updateResponse(displayNumber, (current) => ({ ...current, timeSpent: current.timeSpent + elapsed }));
      }
      currentQuestionStartRef.current = now;
    },
    [updateResponse]
  );

  const moveToQuestion = (index: number) => {
    if (index < 0 || index >= questions.length) {
      return;
    }
    if ((exam?.unsaved_answer_warning ?? true) && hasUnsavedSelection(currentDisplayNumber)) {
      setPendingNavigation(index);
      setUnsavedPromptOpen(true);
      return;
    }
    updateTimeSpent(currentDisplayNumber);
    discardDraftSelection(currentDisplayNumber);
    const targetSection = questions[index]?.subject?.trim() || "General";
    startTransition(() => {
      setCurrentIndex(index);
      setActiveSection(targetSection);
      updateResponse(questions[index].displayNumber, (current) => ({
        ...current,
        visited: true,
        firstVisitedAt: current.firstVisitedAt ?? new Date().toISOString()
      }));
    });
  };

  const commitCurrentAnswer = (markForReview: boolean, requireAnswer: boolean) => {
    const existing = responses[currentDisplayNumber] ?? {
      selected: null,
      markedForReview: false,
      visited: true,
      firstVisitedAt: new Date().toISOString(),
      timeSpent: 0,
      answerChangeCount: 0
    };
    const draft = getDraftSelection(currentDisplayNumber);
    const nextSelected = draft !== undefined ? draft ?? null : existing.selected ?? null;
    if (requireAnswer) {
      const isEmpty = nextSelected === null || (Array.isArray(nextSelected) && nextSelected.length === 0);
      if (isEmpty) {
        setToast("Please select an answer first.");
        window.setTimeout(() => setToast(null), 2000);
        return false;
      }
    }
    const changed = serializeSelected(nextSelected) !== serializeSelected(existing.selected ?? null);
    const updatedState = {
      ...existing,
      selected: nextSelected,
      markedForReview: markForReview,
      answerChangeCount: existing.answerChangeCount + (changed ? 1 : 0)
    };
    updateResponse(currentDisplayNumber, () => updatedState);
    discardDraftSelection(currentDisplayNumber);
    void persistResponse(currentDisplayNumber, updatedState);
    return true;
  };

  const handleSaveAndNext = async (markForReview: boolean) => {
    const saved = commitCurrentAnswer(markForReview, !markForReview);
    if (!saved) {
      return;
    }
    const nextIndex = currentIndex + 1;
    if (nextIndex >= questions.length) {
      return;
    }
    const currentSection = questions[currentIndex]?.subject?.trim() || "General";
    const nextSection = questions[nextIndex]?.subject?.trim() || "General";
    if (currentSection !== nextSection) {
      setPendingSectionIndex(nextIndex);
      setPendingSectionLabel(nextSection);
      setSectionSwitchOpen(true);
      return;
    }
    moveToQuestion(nextIndex);
  };

  const handleSaveAndMarkReview = () => {
    commitCurrentAnswer(true, true);
  };

  const handleUnsavedDecision = (action: "save" | "discard" | "cancel") => {
    if (action === "cancel") {
      setUnsavedPromptOpen(false);
      setPendingNavigation(null);
      return;
    }
    if (action === "save") {
      const saved = commitCurrentAnswer(false, true);
      if (!saved) {
        return;
      }
    } else {
      discardDraftSelection(currentDisplayNumber);
    }
    const target = pendingNavigation;
    setUnsavedPromptOpen(false);
    setPendingNavigation(null);
    if (typeof target === "number") {
      updateTimeSpent(currentDisplayNumber);
      startTransition(() => {
        setCurrentIndex(target);
        updateResponse(questions[target].displayNumber, (current) => ({
          ...current,
          visited: true,
          firstVisitedAt: current.firstVisitedAt ?? new Date().toISOString()
        }));
      });
    }
  };

  const handleSectionSwitchDecision = (action: "switch" | "stay") => {
    if (action === "switch" && typeof pendingSectionIndex === "number") {
      moveToQuestion(pendingSectionIndex);
    }
    setSectionSwitchOpen(false);
    setPendingSectionIndex(null);
    setPendingSectionLabel(null);
  };

  const persistResponse = async (displayNumber: number, override?: ResponseState) => {
    const responseState = override ?? responses[displayNumber];
    if (!responseState) {
      return;
    }
    const payload = {
      displayNumber,
      selectedOption: serializeSelected(responseState.selected),
      markedForReview: responseState.markedForReview,
      timeSpent: responseState.timeSpent,
      firstVisitedAt: responseState.firstVisitedAt,
      answerChangeCount: responseState.answerChangeCount
    };
    try {
      await fetch("/api/exam/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      console.error("response save failed", error);
    }
  };

  const handleAutoSave = async () => {
    if (stage !== "exam") {
      return;
    }
    updateTimeSpent(currentDisplayNumber);
    if (!navigator.onLine) {
      return;
    }
    const payload = buildResponsesPayload(responsesRef.current);
    if (!payload.length) {
      return;
    }
    try {
      await fetch("/api/exam/autosave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: payload })
      });
    } catch (error) {
      console.error("autosave failed", error);
    }
  };

  const handleSubmit = async (mode: string) => {
    if (stage !== "exam" && stage !== "countdown") {
      return;
    }
    if (busy) {
      return;
    }
    if (mode.startsWith("auto_")) {
      setAutoSubmitComplete(false);
    }
    setBusy(true);
    updateTimeSpent(currentDisplayNumber);
    stopTimer();
    try {
      const payload = buildResponsesPayload(responsesRef.current);
      const response = await fetch("/api/exam/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionMode: mode,
          responses: payload
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Submission failed.");
      }
      if (mode === "auto_time_up") {
        setSubmissionNotice("Time is up. Your exam has been auto-submitted.");
      } else {
        setSubmissionNotice(null);
      }
      setSubmissionDetails(data.submissionDetails);
      const feedbackEnabled = exam?.feedback_enabled !== false;
      const feedbackMandatory = exam?.feedback_mandatory === true;
      if (!feedbackEnabled) {
        setStage("done");
      } else if (feedbackMandatory) {
        setStage("feedback");
      } else {
        setStage("submitted");
      }
      setStatusMessage(null);
      if (mode.startsWith("auto_")) {
        setAutoSubmitComplete(true);
      } else {
        setViolationModal(null);
      }
      clearExamStorage();
    } catch (error) {
      console.error("submit failed", error);
      setStatusMessage("Unable to submit the exam. Please notify the proctor.");
      setStage("submitted");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    submitRef.current = (mode: string) => {
      void handleSubmit(mode);
    };
  }, [handleSubmit]);

  const startTimer = () => {
    if (!session || !exam) {
      return;
    }
    stopTimer();
    const totalMinutes = session.allocated_duration ?? exam.duration_minutes;
    const totalSeconds = totalMinutes * 60;
    const startedAt = session.started_at ? new Date(session.started_at).getTime() : Date.now();
    const endTime = startedAt + totalSeconds * 1000;
    timerRef.current = window.setInterval(() => {
      const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining <= 900 && !timerAlertRef.current.fifteen) {
        timerAlertRef.current.fifteen = true;
        setTimerAlert("⏰ 15 minutes remaining");
        window.setTimeout(() => setTimerAlert(null), 4000);
      }
      if (remaining <= 300 && !timerAlertRef.current.five) {
        timerAlertRef.current.five = true;
        setTimerAlert("⏰ 5 minutes remaining");
        window.setTimeout(() => setTimerAlert(null), 4000);
      }
      if (remaining <= 60 && !timerAlertRef.current.one) {
        timerAlertRef.current.one = true;
        setTimerAlert("⏰ 1 minute remaining");
        window.setTimeout(() => setTimerAlert(null), 4000);
      }
      if (remaining === 0) {
        stopTimer();
        void handleSubmit("auto_time_up");
      }
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/exam/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examId: testId, ...registerForm })
      });
      const payload = await response.json();
      if (!response.ok) {
        const message =
          payload?.error ??
          payload?.message ??
          "Unable to register. Please verify the exam ID.";
        throw new Error(message);
      }
      if (payload.status === "completed") {
        setStudent(payload.student);
        setExam(payload.exam);
        setStage("completed");
        return;
      }
      if (payload.reentryReset) {
        clearExamStorage();
      }
      setStudent(payload.student);
      setExam(payload.exam);
      setSession(payload.session);
      setStage("instructions");
    } catch (error) {
      console.error("register failed", error);
      setStatusMessage(error instanceof Error ? error.message : "Unable to register.");
    } finally {
      setBusy(false);
    }
  };

  const readCachedResponses = () => {
    try {
      const raw = window.localStorage.getItem(`trinetra_exam_${testId}`);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as { responses?: Record<number, ResponseState> } | null;
      if (parsed?.responses && typeof parsed.responses === "object") {
        return parsed.responses;
      }
    } catch {
      // ignore cache errors
    }
    return null;
  };

  const ensureFullscreen = useCallback(async () => {
    if (!exam?.fullscreen_required) {
      return true;
    }
    if (!isDesktopDevice()) {
      return true;
    }
    if (!document.fullscreenEnabled) {
      setFullscreenBlocked("Your browser does not support fullscreen mode. Please use Google Chrome (latest version) on a desktop/laptop.");
      return false;
    }
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      setFullscreenBlocked(null);
      return true;
    } catch {
      setFullscreenBlocked("Fullscreen permission was blocked. Please allow fullscreen to continue the exam.");
      return false;
    }
  }, [exam?.fullscreen_required]);

  const startExamNow = async () => {
    const fullscreenReady = await ensureFullscreen();
    if (!fullscreenReady) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/exam/start", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to start exam.");
      }
      setSession(payload.session);
      setExam(payload.exam);
      setQuestions(payload.questions);
      const cached = readCachedResponses();
      setResponses(cached ?? buildResponseState(payload.questions, []).responses);
      setCurrentIndex(0);
      setRemainingSeconds(calculateRemainingSeconds(payload.session, payload.exam));
      setStage("exam");
    } catch (error) {
      console.error("start exam failed", error);
      setStatusMessage(error instanceof Error ? error.message : "Unable to start exam.");
      setStage("instructions");
    } finally {
      setBusy(false);
    }
  };

  const handleBeginExam = async () => {
    if (!instructionAgreed || !instructionReady) {
      return;
    }
    const fullscreenReady = await ensureFullscreen();
    if (!fullscreenReady) {
      return;
    }
    if (exam?.scheduled_start_at) {
      const target = new Date(exam.scheduled_start_at).getTime();
      if (!Number.isNaN(target) && target > Date.now()) {
        scheduleRef.current = target;
        setScheduleCountdown(Math.max(0, Math.floor((target - Date.now()) / 1000)));
        setStage("countdown");
        return;
      }
    }
    await startExamNow();
  };

  useEffect(() => {
    if (stage !== "countdown") {
      return;
    }
    void ensureFullscreen();
    const tick = () => {
      if (!scheduleRef.current) {
        return;
      }
      const remaining = Math.max(0, Math.floor((scheduleRef.current - Date.now()) / 1000));
      setScheduleCountdown(remaining);
      if (remaining <= 0) {
        scheduleRef.current = null;
        setScheduleCountdown(0);
        void startExamNow();
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [stage]);

  useEffect(() => {
    if (stage !== "feedback" || busy) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(`trinetra_feedback_${testId}`);
      if (!raw) {
        return;
      }
      const cached = JSON.parse(raw) as Record<string, unknown> | null;
      if (!cached) {
        return;
      }
      setBusy(true);
      fetch("/api/exam/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cached)
      })
        .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
        .then(({ ok, payload }) => {
          if (!ok) {
            throw new Error(payload?.error ?? "Unable to submit feedback.");
          }
          window.localStorage.removeItem(`trinetra_feedback_${testId}`);
          setStage("done");
          setStatusMessage("Thank you! Your feedback has been submitted.");
          clearExamStorage();
        })
        .catch((error) => {
          console.error("feedback retry failed", error);
        })
        .finally(() => setBusy(false));
    } catch {
      // ignore
    }
  }, [stage, busy, testId]);

  const handleFeedbackSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!feedback.difficulty || !feedback.ui || !feedback.calculator || !feedback.overall || !feedback.recommend) {
      setStatusMessage("Please rate every field before submitting.");
      return;
    }
    setBusy(true);
    setStatusMessage(null);
    const payload = {
      difficultyRating: feedback.difficulty,
      uiRating: feedback.ui,
      calculatorRating: feedback.calculator,
      overallRating: feedback.overall,
      wouldRecommend: feedback.recommend,
      issues: feedback.issues,
      suggestions: feedback.suggestions,
      positiveFeedback: ""
    };
    try {
      let attempt = 0;
      while (attempt < 3) {
        const response = await fetch("/api/exam/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const responsePayload = await response.json();
        if (response.ok) {
          window.localStorage.removeItem(`trinetra_feedback_${testId}`);
          setStage("done");
          setStatusMessage("Thank you! Your feedback has been submitted.");
          clearExamStorage();
          setBusy(false);
          return;
        }
        attempt += 1;
        if (attempt >= 3) {
          throw new Error(responsePayload?.error ?? "Unable to submit feedback.");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500 * 2 ** attempt));
      }
    } catch (error) {
      console.error("feedback failed", error);
      setStatusMessage(error instanceof Error ? error.message : "Unable to submit feedback.");
      try {
        window.localStorage.setItem(`trinetra_feedback_${testId}`, JSON.stringify(payload));
      } catch {
        // ignore storage errors
      }
    } finally {
      setBusy(false);
    }
  };

  const ratingButtons = (value: number, onChange: (rating: number) => void) => (
    <div className="rating-row">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button
          key={rating}
          type="button"
          className={`rating-pill ${value === rating ? "active" : ""}`}
          onClick={() => onChange(rating)}
        >
          {rating}
        </button>
      ))}
    </div>
  );

  const renderRegister = () => (
    <section className="panel exam-gate-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Exam Registration</h2>
          <p>Fill the required fields to begin your exam. All fields are mandatory.</p>
        </div>
      </div>
      <form className="stack-form" onSubmit={handleRegister}>
        <label>
          Full Name
          <input value={registerForm.fullName} onChange={(event) => setRegisterForm((current) => ({ ...current, fullName: event.target.value }))} required />
        </label>
        <label>
          University Roll Number
          <input value={registerForm.rollNumber} onChange={(event) => setRegisterForm((current) => ({ ...current, rollNumber: event.target.value }))} required />
        </label>
        <label>
          Email Address
          <input type="email" value={registerForm.email} onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))} required />
        </label>
        <label>
          Branch / Department
          <select value={registerForm.branch} onChange={(event) => setRegisterForm((current) => ({ ...current, branch: event.target.value }))} required>
            <option value="CSE">CSE</option>
            <option value="AI/ML">AI/ML</option>
          </select>
        </label>
        <label>
          Section
          <select value={registerForm.section} onChange={(event) => setRegisterForm((current) => ({ ...current, section: event.target.value }))} required>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Registering..." : "Continue to Instructions"}
        </button>
      </form>
    </section>
  );

  const renderCompleted = () => (
    <section className="panel exam-gate-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Exam Already Completed</h2>
          <p>You have already completed this exam. Re-entry is not permitted. Contact the administrator for queries.</p>
        </div>
      </div>
      {student ? (
        <div className="feature-card compact-stack">
          <strong>{student.name}</strong>
          <p>Roll No: {student.roll_number}</p>
          <p>Email: {student.email}</p>
        </div>
      ) : null}
    </section>
  );

  const renderInstructions = () => {
    if (!exam) {
      return null;
    }
    return (
      <section className="panel exam-gate-panel instruction-shell">
        <div className="panel-heading compact-heading">
          <div>
            <h2>Exam Instructions</h2>
            <p>Please read all instructions carefully before starting the exam.</p>
          </div>
        </div>
        <div className="instruction-scroll">
          <div className="instruction-section">
            <h3>Section 1 - Examination Details</h3>
            <div className="instruction-cards">
              <div className="instruction-card">
                <strong>Total Questions</strong>
                <span>{exam.total_questions}</span>
              </div>
              <div className="instruction-card">
                <strong>Total Marks</strong>
                <span>{exam.total_marks}</span>
              </div>
              <div className="instruction-card">
                <strong>Duration</strong>
                <span>{exam.duration_minutes} minutes</span>
              </div>
              <div className="instruction-card">
                <strong>Total Sections</strong>
                <span>1</span>
              </div>
            </div>
          </div>

          <div className="instruction-section">
            <h3>Section 2 - Marking Scheme</h3>
            <div className="marking-table">
              <div className="marking-row marking-head">
                <span>Type</span>
                <span>Marks</span>
              </div>
              <div className="marking-row marking-positive">
                <span>MCQ (1 mark) Correct</span>
                <span>+1</span>
              </div>
              <div className="marking-row marking-negative">
                <span>MCQ (1 mark) Wrong</span>
                <span>-1/3</span>
              </div>
              <div className="marking-row marking-positive">
                <span>MCQ (2 marks) Correct</span>
                <span>+2</span>
              </div>
              <div className="marking-row marking-negative">
                <span>MCQ (2 marks) Wrong</span>
                <span>-2/3</span>
              </div>
              <div className="marking-row marking-neutral">
                <span>MSQ / NAT Wrong</span>
                <span>0</span>
              </div>
              <div className="marking-row marking-neutral">
                <span>Unattempted</span>
                <span>0</span>
              </div>
            </div>
          </div>

          <div className="instruction-section">
            <h3>Section 3 - Navigation and Answering</h3>
            <div className="palette-legend">
              <span><span className="legend-square neutral" /> Not Visited</span>
              <span><span className="legend-square green" /> Answered</span>
              <span><span className="legend-square purple" /> Marked for Review (not answered)</span>
              <span><span className="legend-square red" /> Not Answered</span>
              <span><span className="legend-square answered-marked" /> Answered &amp; Marked (will be evaluated)</span>
            </div>
            <div className="instruction-grid">
              <div className="instruction-card">
                <strong>SAVE and NEXT</strong>
                <p>Saves the current answer and moves to the next question.</p>
              </div>
              <div className="instruction-card">
                <strong>CLEAR RESPONSE</strong>
                <p>Clears the selected answer for the current question.</p>
              </div>
              <div className="instruction-card">
                <strong>MARK FOR REVIEW and NEXT</strong>
                <p>Flags the question to revisit later and moves forward.</p>
              </div>
              <div className="instruction-card">
                <strong>SUBMIT</strong>
                <p>Submits the exam after confirmation.</p>
              </div>
            </div>
            <ol className="plain-list">
              <li>Click on an option (A, B, C, D) to select your answer.</li>
              <li>Click SAVE and NEXT to confirm the answer.</li>
              <li>You can change answers any time before final submission.</li>
              <li>Use the question palette to jump directly to any question.</li>
            </ol>
          </div>

          <div className="instruction-section">
            <h3>Section 4 - Calculator Usage</h3>
            <p>A scientific calculator is available from the calculator icon in the exam header. Click the icon to open or hide it. Keyboard input is disabled. Use mouse clicks only.</p>
            <div className="instruction-warning">
              <strong>Calculator Limitations</strong>
              <ul className="plain-list">
                <li>Factorial output is precise up to 14 digits.</li>
                <li>Logarithm functions output is precise up to 5 digits.</li>
                <li>Hyperbolic functions output is precise up to 5 digits.</li>
                <li>Modulus is not precise for numbers with 15 or more digits.</li>
                <li>Supported range: 10^-323 to 10^308.</li>
              </ul>
            </div>
            <p>Tips: Use parentheses for complex expressions, toggle DEG or RAD for trigonometry, ANS recalls last result, memory keys MC, MR, M+, M- are available.</p>
          </div>

          <div className="instruction-section">
            <h3>Section 5 - Examination Rules (Do Not)</h3>
            <div className="rules-grid">
              {[
                "Do not minimize the exam window.",
                "Avoid switching tabs or applications during the exam.",
                "If fullscreen exits, return to fullscreen immediately.",
                "Do not use external calculators or resources.",
                "Do not take screenshots.",
                "Do not communicate with others during the exam.",
                "Do not refresh the page. Progress is auto-saved every 30 seconds."
              ].map((rule, index) => (
                <div className="rule-item" key={rule}>
                  <span className="rule-badge">{index + 1}</span>
                  <span>{rule}</span>
                </div>
              ))}
            </div>
            <p className="warning-text">Security policy: You get up to 3 violations. Each violation triggers a warning. The 3rd violation auto-submits your exam.</p>
          </div>

          <div className="instruction-section">
            <h3>Section 6 - Security & Violations</h3>
            <div className="violation-flow">
              <div className="flow-step">
                <strong>Step 1 - Stay in Fullscreen</strong>
                <p>Your exam window is locked for focus. Exiting fullscreen or switching tabs will trigger a violation warning.</p>
              </div>
              <div className="flow-step">
                <strong>Step 2 - Warning on Every Violation</strong>
                <p>You will see a full-screen warning immediately after each violation.</p>
              </div>
              <div className="flow-step">
                <strong>Step 3 - Auto Submit at 3 Violations</strong>
                <p>After 3 violations, your exam is auto-submitted. There are no extra chances.</p>
              </div>
            </div>
          </div>

          <div className="instruction-section">
            <h3>Section 7 - Submission Process</h3>
            <p>Manual submission uses the SUBMIT button with confirmation. Automatic submission occurs when time reaches 00:00. After submission, re-entry is allowed only if an administrator explicitly grants it.</p>
          </div>

          <div className="instruction-section">
            <h3>Section 8 - Post Submission</h3>
            <p>Results will not be displayed on screen. The college will publish results separately.</p>
            {exam.feedback_enabled === false ? (
              <p>No feedback form is required after submission for this exam.</p>
            ) : exam.feedback_mandatory ? (
              <p>A mandatory feedback form appears immediately after submission.</p>
            ) : (
              <p>A feedback form may appear after submission. You can skip it if allowed.</p>
            )}
          </div>

          <div className="instruction-section">
            <h3>Section 9 - Technical Support</h3>
            <ul className="plain-list">
              <li>Do not refresh the page. Auto-save runs every 30 seconds.</li>
              <li>Use Chrome, Firefox, or Edge with JavaScript enabled.</li>
              <li>Keep a stable internet connection and adequate screen resolution.</li>
            </ul>
          </div>

          <div className="instruction-section">
            <h3>Section 10 - Final Reminders</h3>
            <div className="reminder-grid">
              {[
                "Close all other apps and tabs.",
                "Ensure device is charged or plugged in.",
                "Keep a stable internet connection.",
                "Keep your student ID ready.",
                "No mobile phones during the exam.",
                "Read questions carefully.",
                "Manage time wisely.",
                "Stay calm and focused."
              ].map((item) => (
                <div className="reminder-item" key={item}>
                  <span className="reminder-check" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="instruction-footer">
          <label className="instruction-checkbox">
            <input
              type="checkbox"
              checked={instructionAgreed}
              onChange={(event) => setInstructionAgreed(event.target.checked)}
            />
            I have read and understood all instructions above. I agree to follow all examination rules and regulations.
          </label>
          <div className="instruction-actions">
            <button className="primary-button" type="button" disabled={!instructionAgreed || busy} onClick={handleBeginExam}>
              {busy ? "Starting..." : "I AM READY TO BEGIN"}
            </button>
          </div>
        </div>
      </section>
    );
  };

  const handleCalculatorToggle = () => {
    setCalculatorOpen((current) => {
      if (!current) {
        setCalculatorMinimized(false);
      }
      return !current;
    });
  };

  const handleCalculatorDragStart = (event: { clientX: number; clientY: number }) => {
    const position = calculatorPosition ?? { x: 24, y: 120 };
    calculatorDragRef.current = {
      active: true,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y
    };
  };

  const renderSubmitSummary = () => {
    const stats = computePaletteStats(questions, deferredResponses);
    const remainingLabel = formatDuration(remainingSeconds ?? (exam?.duration_minutes ?? 0) * 60);
    return (
      <div className="modal-overlay">
        <div className="modal-card submission-summary-card">
          <div className="submission-summary-header">
            <h3>Test Summary</h3>
            <span className="summary-remaining">Remaining Time: {remainingLabel}</span>
          </div>
          <div className="summary-grid">
            <div className="summary-row">
              <span className="legend-box green" />
              Answered
              <strong>{stats.answered}</strong>
            </div>
            <div className="summary-row">
              <span className="legend-box red" />
              Not Answered
              <strong>{stats.notAnswered}</strong>
            </div>
            <div className="summary-row">
              <span className="legend-box neutral" />
              Not Visited
              <strong>{stats.notVisited}</strong>
            </div>
            <div className="summary-row">
              <span className="legend-box purple" />
              Mark for Review
              <strong>{stats.marked}</strong>
            </div>
            <div className="summary-row">
              <span className="legend-box answered-marked" />
              Answered &amp; Marked
              <strong>{stats.answeredMarked}</strong>
            </div>
          </div>
          <div className="summary-confirm">
            <p>Are you sure you want to submit the test? No changes will be allowed after submission.</p>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => setSubmitConfirmOpen(false)}>
                No
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setSubmitConfirmOpen(false);
                  void handleSubmit("manual");
                }}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderExam = () => {
    if (!exam || !student) {
      return null;
    }
    const paletteStats = computePaletteStats(questions, deferredResponses);
    const useSections = hasSections;
    const activeLabel = resolvedSectionLabel;
    const visibleQuestions = useSections && activeLabel
      ? questions.filter((question) => (question.subject?.trim() || "General") === activeLabel)
      : questions;
    const questionIndexMap = new Map(questions.map((question, index) => [question.id, index]));
    const negativeMarksLabel = (question?: ExamQuestion | null) => {
      if (!question) {
        return "0";
      }
      if (question.question_type !== "mcq") {
        return "0";
      }
      if (question.marks === 1) {
        return "1/3";
      }
      if (question.marks === 2) {
        return "2/3";
      }
      return (question.marks / 3).toFixed(2);
    };
    return (
      <section className="exam-gate">
        <div className="gate-header">
          <div className="gate-header-left">
            <div className="gate-exam-chip">
              <span>{exam.title}</span>
            </div>
            <div className="gate-sections">
              <span className="sections-label">Sections</span>
              <div className="section-tabs">
                {(useSections ? sectionLabels : ["General"]).map((label) => (
                  <button
                    key={label}
                    type="button"
                    className={`section-tab${activeLabel === label ? " active" : ""}`}
                    onClick={() => setActiveSection(label)}
                  >
                    <span className="section-tab-label">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="gate-header-right">
            <div
              className={`timer-chip${remainingSeconds !== null && remainingSeconds <= 60 ? " timer-chip-critical" : ""}`}
              suppressHydrationWarning
            >
              Time Left : {mounted ? formatDuration(remainingSeconds ?? exam.duration_minutes * 60) : "--:--"}
            </div>
            {exam.calculator_enabled ? (
              <button className="calc-icon-button" type="button" onClick={handleCalculatorToggle} aria-label="Calculator">
                <span className="calc-icon" aria-hidden="true" />
              </button>
            ) : null}
            <div className="student-chip">
              <span className="avatar-dot" />
              <span>{student.name}</span>
            </div>
          </div>
        </div>

        <div className="exam-layout gate-layout">
          <main className="exam-panel gate-panel question-panel">
            <div className="gate-question-meta">
              <span>Question Type: {currentQuestion?.question_type?.toUpperCase() ?? "MCQ"}</span>
              <span>
                Marks for correct answer: {currentQuestion?.marks ?? 0} | Negative Marks: {negativeMarksLabel(currentQuestion)}
              </span>
            </div>
            <div className="panel-heading compact-heading gate-question-heading">
              <div>
                <h3>Question No. {currentQuestion?.displayNumber}</h3>
                <p>{currentQuestion?.subject ?? "General"} {currentQuestion?.topic ? `| ${currentQuestion?.topic}` : ""}</p>
              </div>
            </div>
            <div className="question-prompt exam-no-select">
              <MathText text={currentQuestion?.question_text} />
            </div>
            {currentQuestion?.image_url ? (
              <div className="question-image">
                <img src={currentQuestion.image_url} alt="Question visual" loading="lazy" />
              </div>
            ) : null}
            <div className="response-form">
              {renderOptions(currentQuestion, resolveDisplayedSelection(currentDisplayNumber), (value) => handleSelectOption(currentDisplayNumber, value))}
            </div>
          </main>

          <aside className="exam-panel gate-panel palette-panel">
            <div className="panel-heading compact-heading">
              <div>
                <h3>Question Palette</h3>
                <p>Click a number to jump to a question.</p>
              </div>
              <button
                type="button"
                className="section-info-btn"
                onClick={() => {
                  setSectionInfoLabel(activeLabel);
                  setSectionInfoOpen(true);
                }}
                aria-label="Question palette legend"
              >
                i
              </button>
            </div>
            <div className="palette-grid">
              {visibleQuestions.map((question) => {
                const state = deferredResponses[question.displayNumber];
                const answered = Boolean(state?.selected && serializeSelected(state.selected));
                const visited = Boolean(state?.visited);
                const marked = Boolean(state?.markedForReview);
                const statusClass = answered && marked
                  ? "palette-answered-marked"
                  : answered
                  ? "palette-answered"
                  : marked
                  ? "palette-marked"
                  : visited
                  ? "palette-not-answered"
                  : "palette-not-visited";
                const fullIndex = questionIndexMap.get(question.id) ?? 0;
                const isCurrent = fullIndex === currentIndex ? "current" : "";
                return (
                  <button
                    key={question.id}
                    className={`palette-button ${statusClass} ${isCurrent}`}
                    type="button"
                    onClick={() => moveToQuestion(fullIndex)}
                  >
                    {question.displayNumber}
                  </button>
                );
              })}
            </div>
            <div className="palette-status-grid">
              <div className="status-pill answered">
                <strong>{paletteStats.answered}</strong>
                <span>Answered</span>
              </div>
              <div className="status-pill not-answered">
                <strong>{paletteStats.notAnswered}</strong>
                <span>Not Answered</span>
              </div>
              <div className="status-pill not-visited">
                <strong>{paletteStats.notVisited}</strong>
                <span>Not Visited</span>
              </div>
              <div className="status-pill marked">
                <strong>{paletteStats.marked}</strong>
                <span>Marked for Review</span>
              </div>
              <div className="status-pill answered-marked">
                <strong>{paletteStats.answeredMarked}</strong>
                <span>Answered &amp; Marked</span>
              </div>
            </div>
          </aside>
        </div>

        {exam.calculator_enabled && calculatorOpen ? (
          calculatorMinimized ? (
            <button
              type="button"
              className="calculator-minimized"
              onClick={() => setCalculatorMinimized(false)}
            >
              Calculator
            </button>
          ) : (
            <div
              className="gate-calculator"
              style={{
                left: calculatorPosition?.x ?? 24,
                top: calculatorPosition?.y ?? 120
              }}
            >
              <div className="calc-titlebar" onMouseDown={handleCalculatorDragStart}>
                <span>Scientific Calculator with Complex Number</span>
                <div className="calc-title-actions">
                  <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={() => setCalculatorInfoOpen(true)}>
                    Help
                  </button>
                  <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={() => setCalculatorMinimized(true)}>
                    —
                  </button>
                  <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={() => setCalculatorOpen(false)}>
                    ✕
                  </button>
                </div>
              </div>
              <div className="calc-display-lines">
                <div className="calc-expression">{calculatorExpression}</div>
                <div className="calc-result">
                  {calculatorHasMemory ? <span className="calc-memory-indicator">M</span> : null}
                  <span>{calculatorDisplay}</span>
                </div>
              </div>
              <div className="calc-keypad gate-calc-grid">
                <div className="calc-row">
                  {renderCalcKey("i", () => calculatorRef.current?.inputImaginary())}
                  {renderCalcKey("mod", () => calculatorRef.current?.inputOperator("mod"))}
                  <div className="calc-toggle">
                    <button type="button" className={calculatorMode === "DEG" ? "active" : ""} onClick={() => calculatorRef.current?.setAngleMode("DEG")}>
                      Deg
                    </button>
                    <button type="button" className={calculatorMode === "RAD" ? "active" : ""} onClick={() => calculatorRef.current?.setAngleMode("RAD")}>
                      Rad
                    </button>
                  </div>
                  {renderCalcKey("MC", () => calculatorRef.current?.memoryClear(), "memory")}
                  {renderCalcKey("MR", () => calculatorRef.current?.memoryRecall(), "memory")}
                  {renderCalcKey("MS", () => calculatorRef.current?.memoryStore(), "memory")}
                  {renderCalcKey("M+", () => calculatorRef.current?.memoryAdd(), "memory")}
                  {renderCalcKey("M-", () => calculatorRef.current?.memorySubtract(), "memory")}
                </div>
                <div className="calc-row">
                  {renderCalcKey("sinh", () => calculatorRef.current?.inputFunction("sinh"))}
                  {renderCalcKey("cosh", () => calculatorRef.current?.inputFunction("cosh"))}
                  {renderCalcKey("tanh", () => calculatorRef.current?.inputFunction("tanh"))}
                  {renderCalcKey("Exp", () => calculatorRef.current?.inputExp())}
                  {renderCalcKey("(", () => calculatorRef.current?.inputParen("("))}
                  {renderCalcKey(")", () => calculatorRef.current?.inputParen(")"))}
                  {renderCalcKey("←", () => calculatorRef.current?.backspace(), "danger")}
                  {renderCalcKey("C", () => calculatorRef.current?.clearAll(), "danger")}
                  {renderCalcKey("+/-", () => calculatorRef.current?.toggleSign(), "danger")}
                  {renderCalcKey("sqrt", () => calculatorRef.current?.inputUnaryTemplate("sqrt({x})"))}
                </div>
                <div className="calc-row">
                  {renderCalcKey("sinh⁻¹", () => calculatorRef.current?.inputFunction("asinh"))}
                  {renderCalcKey("cosh⁻¹", () => calculatorRef.current?.inputFunction("acosh"))}
                  {renderCalcKey("tanh⁻¹", () => calculatorRef.current?.inputFunction("atanh"))}
                  {renderCalcKey("log₂x", () => calculatorRef.current?.inputUnaryTemplate("log2({x})"))}
                  {renderCalcKey("ln", () => calculatorRef.current?.inputUnaryTemplate("log({x})"))}
                  {renderCalcKey("log", () => calculatorRef.current?.inputUnaryTemplate("log10({x})"))}
                  {renderCalcKey("7", () => calculatorRef.current?.inputDigit("7"))}
                  {renderCalcKey("8", () => calculatorRef.current?.inputDigit("8"))}
                  {renderCalcKey("9", () => calculatorRef.current?.inputDigit("9"))}
                  {renderCalcKey("/", () => calculatorRef.current?.inputOperator("/"))}
                  {renderCalcKey("%", () => calculatorRef.current?.percent())}
                </div>
                <div className="calc-row">
                  {renderCalcKey("π", () => calculatorRef.current?.inputConstant("pi"))}
                  {renderCalcKey("e", () => calculatorRef.current?.inputConstant("e"))}
                  {renderCalcKey("n!", () => calculatorRef.current?.inputFactorial())}
                  {renderCalcKey("logₓy", () => calculatorRef.current?.inputLogBase())}
                  {renderCalcKey("eˣ", () => calculatorRef.current?.inputUnaryTemplate("exp({x})"))}
                  {renderCalcKey("10ˣ", () => calculatorRef.current?.inputUnaryTemplate("10^({x})"))}
                  {renderCalcKey("4", () => calculatorRef.current?.inputDigit("4"))}
                  {renderCalcKey("5", () => calculatorRef.current?.inputDigit("5"))}
                  {renderCalcKey("6", () => calculatorRef.current?.inputDigit("6"))}
                  {renderCalcKey("×", () => calculatorRef.current?.inputOperator("*"))}
                  {renderCalcKey("1/x", () => calculatorRef.current?.inputUnaryTemplate("1/({x})"))}
                </div>
                <div className="calc-row">
                  {renderCalcKey("sin", () => calculatorRef.current?.inputFunction("sin"))}
                  {renderCalcKey("cos", () => calculatorRef.current?.inputFunction("cos"))}
                  {renderCalcKey("tan", () => calculatorRef.current?.inputFunction("tan"))}
                  {renderCalcKey("xʸ", () => calculatorRef.current?.inputOperator("^"))}
                  {renderCalcKey("x³", () => calculatorRef.current?.inputUnaryTemplate("({x})^3"))}
                  {renderCalcKey("x²", () => calculatorRef.current?.inputUnaryTemplate("({x})^2"))}
                  {renderCalcKey("1", () => calculatorRef.current?.inputDigit("1"))}
                  {renderCalcKey("2", () => calculatorRef.current?.inputDigit("2"))}
                  {renderCalcKey("3", () => calculatorRef.current?.inputDigit("3"))}
                  {renderCalcKey("−", () => calculatorRef.current?.inputOperator("-"))}
                </div>
                <div className="calc-row">
                  {renderCalcKey("sin⁻¹", () => calculatorRef.current?.inputFunction("asin"))}
                  {renderCalcKey("cos⁻¹", () => calculatorRef.current?.inputFunction("acos"))}
                  {renderCalcKey("tan⁻¹", () => calculatorRef.current?.inputFunction("atan"))}
                  {renderCalcKey("y√x", () => calculatorRef.current?.inputUnaryTemplate("sqrt({x})"))}
                  {renderCalcKey("³√", () => calculatorRef.current?.inputUnaryTemplate("cbrt({x})"))}
                  {renderCalcKey("|x|", () => calculatorRef.current?.inputUnaryTemplate("abs({x})"))}
                  {renderCalcKey("0", () => calculatorRef.current?.inputDigit("0"))}
                  {renderCalcKey(".", () => calculatorRef.current?.inputDot())}
                  {renderCalcKey("+", () => calculatorRef.current?.inputOperator("+"))}
                  {renderCalcKey("=", () => calculatorRef.current?.evaluate(), "equals", 2)}
                </div>
              </div>
            </div>
          )
        ) : null}

        <div className="exam-actions-bar">
          <div className="nav-left">
            <button className="nav-button review-button" type="button" onClick={() => handleSaveAndNext(true)}>
              Mark for Review &amp; Next
            </button>
            <button className="nav-button clear-button" type="button" onClick={handleClearResponse}>
              Clear Response
            </button>
          </div>
          <div className="nav-right">
            <button className="nav-button prev-button" type="button" onClick={() => moveToQuestion(currentIndex - 1)}>
              Previous
            </button>
            {currentIndex < questions.length - 1 ? (
              <button className="nav-button save-button" type="button" onClick={() => handleSaveAndNext(false)}>
                Save &amp; Next
              </button>
            ) : (
              <button className="nav-button submit-button" type="button" onClick={() => setSubmitConfirmOpen(true)}>
                Submit Exam
              </button>
            )}
          </div>
        </div>
      </section>
    );
  };

  const renderSubmitted = () => (
    <section className="panel exam-gate-panel">
      <div className="submission-card">
        <div className="submission-check" />
        <h2>Exam Submitted Successfully</h2>
        {submissionDetails ? (
          <div className="submission-details">
            <p><strong>Name:</strong> {submissionDetails.studentName}</p>
            <p><strong>Roll Number:</strong> {submissionDetails.rollNumber}</p>
            <p><strong>Exam:</strong> {submissionDetails.examTitle}</p>
            <p><strong>Submission Time:</strong> {new Date(submissionDetails.submittedAt).toLocaleString("en-IN")}</p>
            <p className="highlight-email"><strong>Email:</strong> {submissionDetails.email}</p>
          </div>
        ) : null}
        <div className="submission-info">
          {submissionNotice ? <p className="alert-banner alert-warning">{submissionNotice}</p> : null}
          <p>Results will not be displayed here for security reasons. The college will publish results separately.</p>
          <div className="timeline">
            <div className="timeline-item"><span>Just Now</span><strong>Exam Submitted</strong></div>
            <div className="timeline-item"><span>Next 5 minutes</span><strong>Complete Feedback</strong></div>
            <div className="timeline-item"><span>Next</span><strong>College Result Publication</strong></div>
          </div>
          <p className="warning-text">Re-entry is possible only if an administrator explicitly allows it.</p>
        </div>
        {exam?.feedback_enabled === false ? (
          <button className="primary-button" type="button" onClick={() => setStage("done")}>
            Close Window
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={() => setStage("feedback")}>
            Continue to Feedback Form
          </button>
        )}
      </div>
    </section>
  );

  const renderFeedback = () => (
    <section className="panel exam-gate-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>{exam?.feedback_mandatory ? "Mandatory Feedback Form" : "Feedback Form"}</h2>
          <p>
            {exam?.feedback_mandatory
              ? "Please complete this form before exiting. All ratings are required."
              : "Help us improve by sharing quick feedback about the exam."}
          </p>
        </div>
      </div>
      <form className="stack-form" onSubmit={handleFeedbackSubmit}>
        <div className="rating-field">
          <strong>Exam difficulty (1-5)</strong>
          {ratingButtons(feedback.difficulty, (value) => setFeedback((current) => ({ ...current, difficulty: value })))}
        </div>
        <div className="rating-field">
          <strong>UI/UX experience (1-5)</strong>
          {ratingButtons(feedback.ui, (value) => setFeedback((current) => ({ ...current, ui: value })))}
        </div>
        <div className="rating-field">
          <strong>Calculator functionality (1-5)</strong>
          {ratingButtons(feedback.calculator, (value) => setFeedback((current) => ({ ...current, calculator: value })))}
        </div>
        <div className="rating-field">
          <strong>Overall experience (1-5)</strong>
          {ratingButtons(feedback.overall, (value) => setFeedback((current) => ({ ...current, overall: value })))}
        </div>
        <div className="rating-field">
          <strong>Would you recommend this exam? (1-5)</strong>
          {ratingButtons(feedback.recommend, (value) => setFeedback((current) => ({ ...current, recommend: value })))}
        </div>
        <label>
          Technical Issues Faced
          <textarea rows={3} value={feedback.issues} onChange={(event) => setFeedback((current) => ({ ...current, issues: event.target.value }))} />
        </label>
        <label>
          Suggestions for Improvement
          <textarea rows={3} value={feedback.suggestions} onChange={(event) => setFeedback((current) => ({ ...current, suggestions: event.target.value }))} />
        </label>
        <div className="button-row">
          {!exam?.feedback_mandatory ? (
            <button className="ghost-button" type="button" onClick={() => setStage("done")}>
              Skip Feedback
            </button>
          ) : null}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Submitting..." : "Submit Feedback"}
          </button>
        </div>
      </form>
    </section>
  );

  const renderDone = () => (
    <section className="panel exam-gate-panel">
      <div className="panel-heading compact-heading">
        <div>
          <h2>Thank You</h2>
          <p>Your feedback has been submitted successfully. You may now close this window.</p>
        </div>
      </div>
    </section>
  );

  const infoSectionLabel = sectionInfoLabel ?? resolvedSectionLabel;
  const infoQuestions = hasSections
    ? questions.filter((question) => (question.subject?.trim() || "General") === infoSectionLabel)
    : questions;
  const infoStats = computePaletteStats(infoQuestions, deferredResponses);

  const shellClass = `exam-shell gate-shell${stage === "exam" && calculatorOpen ? " calc-open" : ""}`;

  return (
    <div className={shellClass}>
      {toast ? <div className="toast">{toast}</div> : null}
      {timerAlert ? <div className="toast alert-warning">{timerAlert}</div> : null}
      {!isOnline && (stage === "exam" || stage === "countdown") ? (
        <div className="alert-banner alert-warning">
          Connection lost. Your answers are saved locally and will sync when the connection returns.
        </div>
      ) : null}
      {statusMessage ? <div className="alert-banner alert-error">{statusMessage}</div> : null}
      {stage === "loading" ? <div className="panel exam-gate-panel">Loading exam session...</div> : null}
      {stage === "register" ? renderRegister() : null}
      {stage === "instructions" ? renderInstructions() : null}
      {stage === "countdown" ? (
        <div className="exam-countdown-overlay">
          <div className="countdown-card">
            <h2>{scheduleCountdown && scheduleCountdown > 0 ? "Exam starts in" : "Starting exam..."}</h2>
            <div className="countdown-timer">{formatDuration(scheduleCountdown ?? 0)}</div>
            <p>
              {scheduleCountdown && scheduleCountdown > 0
                ? "Please stay on this screen. The exam will start automatically."
                : "Preparing your exam. Please hold."}
            </p>
          </div>
        </div>
      ) : null}
      {stage === "exam" ? renderExam() : null}
      {stage === "submitted" ? renderSubmitted() : null}
      {stage === "feedback" ? renderFeedback() : null}
      {stage === "done" ? renderDone() : null}
      {stage === "completed" ? renderCompleted() : null}
      {submitConfirmOpen ? renderSubmitSummary() : null}

      {fullscreenBlocked ? (
        <div className="fullscreen-blocker">
          <div className="fullscreen-card">
            <h2>Fullscreen Required</h2>
            <p>{fullscreenBlocked}</p>
            <button type="button" className="primary-button" onClick={() => void ensureFullscreen()}>
              Go Fullscreen
            </button>
          </div>
        </div>
      ) : null}

      {fullscreenOverlay ? (
        <div className="fullscreen-blocker">
          <div className="fullscreen-card">
            <h2>You have exited fullscreen</h2>
            <p>Press F11 or click below to re-enter fullscreen and continue the exam.</p>
            <button type="button" className="primary-button" onClick={() => void ensureFullscreen()}>
              Go Fullscreen
            </button>
          </div>
        </div>
      ) : null}

      {violationModal ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>{violationModal.title}</h3>
            <p>{violationModal.message}</p>
            <p className="warning-text">Violations: {violationModal.count} / {violationModal.max}</p>
            {!violationModal.autoSubmit ? (
              <p className="warning-text">Auto-submit in {violationCountdown ?? 15}s if you do not return to fullscreen.</p>
            ) : null}
            {violationModal.autoSubmit ? (
              <div className="button-row">
                {autoSubmitComplete ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setViolationModal(null)}
                  >
                    Test submitted successfully
                  </button>
                ) : (
                  <button type="button" className="primary-button" disabled>
                    Auto-submitting...
                  </button>
                )}
              </div>
            ) : (
              <div className="button-row">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    setViolationModal(null);
                    clearViolationCountdown();
                    if (violationModal.requiresFullscreen) {
                      void ensureFullscreen();
                    }
                  }}
                >
                  Resume Exam
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {unsavedPromptOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Unsaved Answer</h3>
            <p>You selected an answer but have not saved it. Leaving now will discard your selection.</p>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => handleUnsavedDecision("save")}>
                Save &amp; Go
              </button>
              <button type="button" className="ghost-button" onClick={() => handleUnsavedDecision("discard")}>
                Go Without Saving
              </button>
              <button type="button" className="ghost-button" onClick={() => handleUnsavedDecision("cancel")}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {sectionSwitchOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Switch Section</h3>
            <p>
              You have reached the last question of this section. Do you want to switch
              to <strong>{pendingSectionLabel ?? "the next section"}</strong> now?
            </p>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => handleSectionSwitchDecision("switch")}>
                Switch Section
              </button>
              <button type="button" className="ghost-button" onClick={() => handleSectionSwitchDecision("stay")}>
                Stay Here
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {sectionInfoOpen ? (
        <div className="modal-overlay">
          <div className="modal-card gate-legend-modal">
            <h3>{infoSectionLabel}</h3>
            <div className="gate-legend-list">
              <div className="gate-legend-item">
                <span className="gate-status-icon not-visited">{infoStats.notVisited}</span>
                <div>
                  <strong>Not Visited</strong>
                  <p>You have not visited the question yet.</p>
                </div>
              </div>
              <div className="gate-legend-item">
                <span className="gate-status-icon not-answered">{infoStats.notAnswered}</span>
                <div>
                  <strong>Not Answered</strong>
                  <p>You have visited but not answered the question.</p>
                </div>
              </div>
              <div className="gate-legend-item">
                <span className="gate-status-icon answered">{infoStats.answered}</span>
                <div>
                  <strong>Answered</strong>
                  <p>This will be evaluated.</p>
                </div>
              </div>
              <div className="gate-legend-item">
                <span className="gate-status-icon marked">{infoStats.marked}</span>
                <div>
                  <strong>Marked for Review</strong>
                  <p>You have NOT answered but marked it for review.</p>
                </div>
              </div>
              <div className="gate-legend-item">
                <span className="gate-status-icon answered-marked">{infoStats.answeredMarked}</span>
                <div>
                  <strong>Answered &amp; Marked for Review</strong>
                  <p>This will also be evaluated.</p>
                </div>
              </div>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setSectionInfoOpen(false);
                  setSectionInfoLabel(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {calculatorInfoOpen ? (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Scientific Calculator Help</h3>
            <div className="modal-section">
              <strong>Memory Functions</strong>
              <ul className="plain-list">
                <li>MC: Clear memory</li>
                <li>MR: Recall memory</li>
                <li>MS: Store to memory</li>
                <li>M+: Add to memory</li>
                <li>M-: Subtract from memory</li>
              </ul>
            </div>
            <div className="modal-section">
              <strong>Power &amp; Root</strong>
              <ul className="plain-list">
                <li>x²: Square, x³: Cube, xʸ: Power</li>
                <li>y√x: Square root, ³√: Cube root</li>
                <li>10ˣ and eˣ for exponential growth</li>
              </ul>
            </div>
            <div className="modal-section">
              <strong>Logarithms</strong>
              <ul className="plain-list">
                <li>log: base 10, ln: natural log</li>
                <li>log₂x and logₓy for custom base</li>
              </ul>
            </div>
            <div className="modal-section">
              <strong>Trigonometry</strong>
              <ul className="plain-list">
                <li>Use Deg/Rad toggle before sin/cos/tan</li>
                <li>Inverse trig uses sin⁻¹/cos⁻¹/tan⁻¹</li>
              </ul>
            </div>
            <div className="modal-section">
              <strong>Complex Numbers</strong>
              <ul className="plain-list">
                <li>Use i to enter imaginary values (e.g., 3 + 4i)</li>
                <li>|x| gives the absolute magnitude</li>
              </ul>
            </div>
            <div className="modal-section">
              <strong>Limitations</strong>
              <ul className="plain-list">
                <li>Keyboard input is disabled. Use mouse clicks only.</li>
                <li>Factorial is precise up to 14 digits.</li>
                <li>Logarithms are precise up to 5 digits.</li>
                <li>Hyperbolic functions are precise up to 5 digits.</li>
                <li>Modulus is not precise for numbers with 15+ digits.</li>
                <li>Supported range: 10^-323 to 10^308.</li>
              </ul>
            </div>
            <button type="button" className="primary-button" onClick={() => setCalculatorInfoOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildResponseState(questions: ExamQuestion[], responseRows: Array<{
  question_id: number;
  selected_option: string | null;
  marked_for_review: boolean;
  time_spent: number;
  first_visited_at: string | null;
  answer_change_count: number;
}>) {
  const map = new Map(questions.map((question) => [question.id, question.displayNumber]));
  const responses: Record<number, ResponseState> = {};
  for (const response of responseRows) {
    const displayNumber = map.get(response.question_id);
    if (!displayNumber) {
      continue;
    }
    responses[displayNumber] = {
      selected: parseSelected(response.selected_option),
      markedForReview: response.marked_for_review,
      visited: true,
      firstVisitedAt: response.first_visited_at ?? null,
      timeSpent: response.time_spent ?? 0,
      answerChangeCount: response.answer_change_count ?? 0
    };
  }
  for (const question of questions) {
    if (!responses[question.displayNumber]) {
      responses[question.displayNumber] = {
        selected: null,
        markedForReview: false,
        visited: false,
        firstVisitedAt: null,
        timeSpent: 0,
        answerChangeCount: 0
      };
    }
  }
  return { responses };
}

function serializeSelected(value: string | string[] | null) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return value;
}

function parseSelected(value: string | null) {
  if (!value) {
    return null;
  }
  if (value.includes(",")) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return value;
}

function buildResponsesPayload(responses: Record<number, ResponseState>) {
  return Object.entries(responses).map(([displayNumber, state]) => ({
    displayNumber: Number(displayNumber),
    selectedOption: serializeSelected(state.selected),
    markedForReview: state.markedForReview,
    timeSpent: state.timeSpent,
    firstVisitedAt: state.firstVisitedAt,
    answerChangeCount: state.answerChangeCount
  }));
}

function calculateRemainingSeconds(session: ExamSession, exam: ExamConfig) {
  const totalMinutes = session.allocated_duration ?? exam.duration_minutes;
  const totalSeconds = totalMinutes * 60;
  if (!session.started_at) {
    return totalSeconds;
  }
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000));
  return Math.max(0, totalSeconds - elapsed);
}

function renderOptions(question: ExamQuestion | undefined, selected: string | string[] | null, onChange: (value: string | string[] | null) => void) {
  if (!question) {
    return null;
  }
  if (question.question_type === "numerical") {
    const rawValue = typeof selected === "string" ? selected : "";
    const sanitized = rawValue.replace(/[^0-9.\-]/g, "");
    const hasLeadingMinus = sanitized.startsWith("-");
    const stripped = sanitized.replace(/-/g, "");
    const [whole, ...fractionParts] = stripped.split(".");
    const baseValue = whole + (fractionParts.length ? `.${fractionParts.join("")}` : "");
    const value = hasLeadingMinus ? `-${baseValue}` : baseValue;
    const applyValue = (next: string) => onChange(next ? next : null);
    const appendDigit = (digit: string) => {
      const next = `${value}${digit}`.replace(/^(-?)0+(?=\d)/, "$1");
      applyValue(next);
    };
    const appendDot = () => {
      if (!value.includes(".")) {
        applyValue(value ? `${value}.` : "0.");
      }
    };
    const toggleSign = () => {
      if (!value || value === "0" || value === "0.") {
        applyValue("-");
        return;
      }
      applyValue(value.startsWith("-") ? value.slice(1) : `-${value}`);
    };
    const backspace = () => applyValue(value.slice(0, -1));
    const clearValue = () => applyValue("");
    return (
      <div className="numeric-entry">
        <label>
          Numeric Answer
          <input
            className="nat-input-field"
            inputMode="decimal"
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value.replace(/[^0-9.\-]/g, "");
              applyValue(nextValue);
            }}
          />
        </label>
        <div className="numeric-keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button key={digit} type="button" className="numeric-key" onClick={() => appendDigit(digit)}>
              {digit}
            </button>
          ))}
          <button type="button" className="numeric-key" onClick={toggleSign}>±</button>
          <button type="button" className="numeric-key" onClick={() => appendDigit("0")}>0</button>
          <button type="button" className="numeric-key" onClick={appendDot}>.</button>
          <button type="button" className="numeric-key danger" onClick={backspace}>
            ⌫
          </button>
          <button type="button" className="numeric-key danger" onClick={clearValue}>
            Clear
          </button>
        </div>
      </div>
    );
  }

  const options = [
    { key: "A", value: question.option_a },
    { key: "B", value: question.option_b },
    { key: "C", value: question.option_c },
    { key: "D", value: question.option_d }
  ].filter((option) => option.value);

  if (question.question_type === "msq") {
    const selectedArray = Array.isArray(selected) ? selected : selected ? [selected] : [];
    return (
      <>
        {options.map((option) => (
          <label className="option-row" key={`${question.id}-${option.key}`}>
            <input
              type="checkbox"
              checked={selectedArray.includes(option.key)}
              onChange={() => {
                const next = selectedArray.includes(option.key)
                  ? selectedArray.filter((item) => item !== option.key)
                  : [...selectedArray, option.key].sort();
                onChange(next.length ? next : null);
              }}
            />
            <span>
              <strong>{option.key}.</strong> <MathText text={option.value ?? ""} />
            </span>
          </label>
        ))}
      </>
    );
  }

  return (
    <>
    {options.map((option) => (
      <label className="option-row" key={`${question.id}-${option.key}`}>
        <input
          type="radio"
          name={`question-${question.id}`}
          checked={selected === option.key}
          onChange={() => onChange(option.key)}
        />
        <span>
          <strong>{option.key}.</strong> <MathText text={option.value ?? ""} />
        </span>
      </label>
    ))}
    </>
  );
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isDesktopDevice() {
  if (typeof navigator === "undefined") {
    return true;
  }
  return !/(Mobi|Android|iPhone|iPad|Tablet)/i.test(navigator.userAgent);
}

function clearExamStorage() {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
}

function renderCalcKey(label: string, onClick: () => void, variant: "default" | "danger" | "memory" | "equals" = "default", span = 1) {
  return (
    <button
      key={`${label}-${variant}`}
      type="button"
      className={`calc-key ${variant}`}
      style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function computePaletteStats(questions: ExamQuestion[], responses: Record<number, ResponseState>) {
  let answered = 0;
  let notAnswered = 0;
  let marked = 0;
  let answeredMarked = 0;
  let notVisited = 0;

  for (const question of questions) {
    const state = responses[question.displayNumber];
    const hasAnswer = Boolean(state?.selected && serializeSelected(state.selected));
    const isMarked = Boolean(state?.markedForReview);
    const visited = Boolean(state?.visited);

    if (!visited) {
      notVisited += 1;
    } else if (hasAnswer && isMarked) {
      answeredMarked += 1;
    } else if (hasAnswer) {
      answered += 1;
    } else if (isMarked) {
      marked += 1;
    } else {
      notAnswered += 1;
    }
  }

  return { answered, notAnswered, marked, answeredMarked, notVisited };
}

function getSectionLabels(questions: ExamQuestion[]) {
  const labels = questions
    .map((question) => question.subject?.trim() || "General")
    .filter(Boolean);
  return Array.from(new Set(labels));
}
