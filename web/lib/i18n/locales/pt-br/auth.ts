export const auth = {
  errors: {
    authUnavailable: "Não foi possível concluir a autenticação."
  },
  notices: {
    sessionUnavailable: "Sessão indisponível",
    sessionStarted: "Sessão iniciada",
    accountCreated: "Conta criada",
    localMerged: "O progresso local deste dispositivo foi associado à sua conta quando aplicável.",
    loggedOut: "Sessão encerrada",
    localMode: "Você voltou ao modo local deste dispositivo.",
    verificationResent: "Verificação reenviada",
    verificationResentMessage: "Se o email existir e estiver ativo, você receberá um novo link de verificação.",
    resendFailed: "Falha ao reenviar",
    logoutFailed: "Falha ao sair"
  },
  hero: {
    loginEyebrow: "Sessão segura",
    registerEyebrow: "Criação de conta",
    loginTitle: "Entre para sincronizar seu progresso.",
    registerTitle: "Crie sua conta e continue de qualquer dispositivo.",
    lead:
      "A autenticação usa cookie HttpOnly no backend. Quando você entra, o sistema associa histórico local, marcadores, notas e revisões pendentes à sua conta sem expor a sessão em localStorage.",
    benefitsAriaLabel: "Benefícios da conta"
  },
  stats: [
    {
      label: "Sincronização",
      value: "Conta",
      meta: "Histórico, revisão e progresso unificados."
    },
    {
      label: "Segurança",
      value: "HttpOnly",
      meta: "Sessão protegida via cookie e backend tipado."
    },
    {
      label: "Continuidade",
      value: "Auto-merge",
      meta: "O dispositivo atual é consolidado quando aplicável."
    },
    {
      label: "Acesso",
      value: "Web",
      meta: "Pronto para estudo, simulados e revisão guiada."
    }
  ],
  form: {
    loginTitle: "Entrar",
    registerTitle: "Criar conta",
    loginSubtitle: "Use a mesma conta para retomar estudos e simulados em qualquer navegador.",
    registerSubtitle: "Crie uma conta para salvar seu progresso e destravar os fluxos protegidos.",
    requiredMessage: "Preencha email e senha antes de continuar.",
    invalidPasswordMessage: "Use pelo menos 8 caracteres para criar a conta.",
    name: "Nome",
    nameHint: "Opcional. Facilita identificar a conta.",
    email: "Email",
    password: "Senha",
    loginPasswordHint: "Use a senha da conta existente.",
    registerPasswordHint: "Mínimo de 8 caracteres.",
    goToRegister: "Ir para cadastro",
    forgotPassword: "Esqueci a senha"
  },
  verification: {
    checkEmailTitle: "Verifique seu e-mail",
    checkEmailMessage:
      "Se for possível criar uma conta para {email}, enviamos um link de confirmação. Abra o link para ativar a conta e entrar.",
    checkEmailHint: "Não recebeu? Confira a caixa de spam ou reenvie o link em alguns minutos.",
    resend: "Reenviar e-mail de verificação",
    useAnotherEmail: "Usar outro e-mail",
    notVerifiedTitle: "E-mail ainda não verificado",
    notVerifiedMessage: "Confirme seu e-mail pelo link que enviamos antes de entrar. Você pode pedir um novo link abaixo."
  },
  account: {
    roleLabel: "papel",
    emailVerified: "Email verificado",
    emailPending: "Email pendente"
  },
  flow: {
    title: "O que acontece ao autenticar",
    subtitle: "Fluxo pensado para preservar dados e evitar retrabalho.",
    steps: [
      {
        title: "1. Sessão protegida no backend",
        description:
          "O login estabelece a sessão principal por cookie HttpOnly e mantém o token em memória apenas como compatibilidade transitória."
      },
      {
        title: "2. Merge do progresso local",
        description:
          "Sessões, marcadores, notas e itens da fila de revisão do dispositivo atual podem ser associados à sua conta automaticamente."
      },
      {
        title: "3. Continuidade entre dispositivos",
        description:
          "Depois do login, o dashboard, o histórico e os modos de estudo passam a refletir o escopo da conta."
      }
    ]
  }
} as const;
