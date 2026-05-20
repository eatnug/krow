export interface Question {
  id: string;
  question: string;
  context?: string;
  options?: string[];
}

export interface Answer {
  question_id: string;
  answer: string;
  rationale?: string;
}

export interface AnswerPayload {
  answers: Answer[];
}

