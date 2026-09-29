export const password = {
  forgot: {
    title: "Recuperar senha",
    subtitle: "Solicite um link seguro para redefinir sua senha.",
    emailRequiredTitle: "Email obrigatório",
    emailRequiredMessage: "Informe o email da conta para continuar.",
    requestedTitle: "Solicitação registrada",
    requestedMessage: "Se a conta existir, um email com o link de redefinição foi enviado.",
    failedTitle: "Falha ao solicitar",
    failedMessage: "Não foi possível iniciar a recuperação.",
    emailLabel: "Email",
    submit: "Enviar link",
    backToLogin: "Voltar ao login"
  },
  reset: {
    title: "Definir nova senha",
    subtitle: "Use o link recebido por email para concluir a redefinição.",
    missingTokenMessage: "O link de redefinição está incompleto.",
    invalidPasswordMessage: "Use pelo menos 8 caracteres.",
    updatedTitle: "Senha atualizada",
    updatedMessage: "Sua senha foi redefinida. Entre novamente com a nova credencial.",
    failedTitle: "Falha ao redefinir",
    failedMessage: "Não foi possível redefinir a senha.",
    passwordLabel: "Nova senha",
    passwordHint: "Mínimo de 8 caracteres.",
    submit: "Atualizar senha"
  },
  verify: {
    title: "Verificação de email",
    subtitle: "Confirmação de identidade para fortalecer a conta.",
    missingTokenMessage: "O link de verificação está incompleto.",
    successTitle: "Email verificado",
    successMessage: "O email {email} foi validado com sucesso.",
    failedTitle: "Falha na verificação",
    failedMessage: "Não foi possível validar o email.",
    redirecting: "Sessão iniciada. Redirecionando…",
    goToLogin: "Ir para login"
  }
} as const;
