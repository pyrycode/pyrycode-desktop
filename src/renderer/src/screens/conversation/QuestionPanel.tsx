import { PyryMark } from '../../theme/PyryMark'
import type { Question } from '../../store/questionBatches'
import type { QuestionPickEvent, QuestionSelection } from '../../store/questionPicksStore'

export const QUESTION_CANCEL_COPY = 'Cancel'
export const QUESTION_CONTINUE_COPY = 'Continue'
export const QUESTION_OTHER_PLACEHOLDER_COPY = 'Type your answer'
const QUESTION_OTHER_INPUT_COPY = 'Other. Type something.'
export const QUESTION_OTHER_TICK_COPY = 'Other'

export function optionPickEventFor(args: {
  multiSelect: boolean
  questionBatchId: string
  questionIndex: number
  optionIndex: number
}): QuestionPickEvent {
  const { multiSelect, questionBatchId, questionIndex, optionIndex } = args
  return {
    type: multiSelect ? 'optionToggled' : 'optionPicked',
    questionBatchId,
    questionIndex,
    optionIndex
  }
}

export function otherPickEventFor(args: {
  multiSelect: boolean
  questionBatchId: string
  questionIndex: number
}): QuestionPickEvent {
  const { multiSelect, questionBatchId, questionIndex } = args
  return { type: multiSelect ? 'otherToggled' : 'otherPicked', questionBatchId, questionIndex }
}

export function QuestionTick(): JSX.Element {
  return (
    <svg
      className="question-panel__control-tick"
      viewBox="0 0 12 12"
      fill="currentColor"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M10.7051 1.63436C11.0243 1.85929 11.0957 2.29186 10.8636 2.60114L5.14911 10.2142C5.02634 10.3786 4.8366 10.4803 4.62678 10.4976C4.41695 10.5149 4.21382 10.4392 4.06649 10.2964L1.20927 7.52802C0.930244 7.25767 0.930244 6.81862 1.20927 6.54827C1.48829 6.27792 1.94143 6.27792 2.22046 6.54827L4.48615 8.74352L9.70951 1.78576C9.94166 1.47648 10.3881 1.40727 10.7073 1.6322L10.7051 1.63436Z" />
    </svg>
  )
}

// Daemon fields are text children only. Control identity uses client-owned positions.
export function QuestionPanelView({
  questions, selections, canAnswer, responseAvailable, onCancel, onAnswer,
  onOptionChosen, onOtherChosen, onOtherTextChanged
}: {
  questions: readonly Question[]
  selections: ReadonlyMap<number, QuestionSelection>
  canAnswer: boolean
  responseAvailable: boolean
  onCancel: () => void
  onAnswer: () => void
  onOptionChosen: (questionIndex: number, optionIndex: number) => void
  onOtherChosen: (questionIndex: number) => void
  onOtherTextChanged: (questionIndex: number, text: string) => void
}): JSX.Element {
  return (
    <div className="question-panel question-batch">
      <p className="question-batch__heading">Claude has questions</p>
      {questions.map((question, questionIndex) => {
        const selection = selections.get(questionIndex)
        const inputType = question.multiSelect ? 'checkbox' : 'radio'
        const groupName = `question-panel-option-${questionIndex}`
        const controlClass = `question-panel__control question-panel__control--${question.multiSelect ? 'checkbox' : 'radio'}`
        const selector = question.multiSelect ? <QuestionTick /> : <span className="question-panel__control-dot" />
        return (
          <div className="question-batch__question" key={questionIndex}>
            <div className="question-panel__title">
              <PyryMark className="question-panel__mark" width={14} height={16} />
              <span className="question-panel__label">{question.header}</span>
            </div>
            <div className="question-panel__box">
              <p className="question-panel__question">{question.question}</p>
              <div className="question-panel__options">
                {question.options.map((option, optionIndex) => (
                  <label className="question-panel__option" key={optionIndex}>
                    <input type={inputType} name={groupName} className="question-panel__input"
                      checked={selection?.optionIndices.includes(optionIndex) ?? false}
                      onChange={() => onOptionChosen(questionIndex, optionIndex)} />
                    <span className={controlClass} aria-hidden="true">
                      {selection?.optionIndices.includes(optionIndex) ? selector : null}
                    </span>
                    <div className="question-panel__option-text">
                      <p className="question-panel__option-label">{option.label}</p>
                      {option.description !== '' && <p className="question-panel__option-description">{option.description}</p>}
                    </div>
                  </label>
                ))}
                <div className="question-panel__option">
                  <label className="question-panel__other-control">
                    <input type={inputType} name={groupName} className="question-panel__input"
                      checked={selection?.otherTicked ?? false} aria-label={QUESTION_OTHER_TICK_COPY}
                      onChange={() => onOtherChosen(questionIndex)} />
                    <span className={`${controlClass} question-panel__control--other`} aria-hidden="true">
                      {selection?.otherTicked ? selector : null}
                    </span>
                  </label>
                  <div className="question-batch__other">
                    <p className="question-batch__other-label">Other</p>
                    <div className="question-panel__other-field">
                    <input type="text" className="question-panel__other-input" value={selection?.otherText ?? ''}
                      onChange={(event) => onOtherTextChanged(questionIndex, event.target.value)}
                      placeholder={QUESTION_OTHER_PLACEHOLDER_COPY} aria-label={QUESTION_OTHER_INPUT_COPY} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })}
      <div className="question-panel__actions">
        <button type="button" className="button-small question-panel__cancel" disabled={!responseAvailable} onClick={onCancel}>
          {QUESTION_CANCEL_COPY}
        </button>
        <button type="button" className="button-small question-panel__continue" disabled={!canAnswer || !responseAvailable} onClick={onAnswer}>
          {QUESTION_CONTINUE_COPY}
        </button>
      </div>
    </div>
  )
}
