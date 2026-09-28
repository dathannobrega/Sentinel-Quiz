export const api = {
  timeout: "A requisição demorou mais do que o esperado. Tente novamente.",
  offline: "Você parece estar offline. Verifique sua conexão e tente novamente.",
  network: "Não foi possível falar com o servidor agora. Tente novamente em instantes.",
  blocked:
    "Não foi possível falar com o servidor. A requisição pode ter sido bloqueada (CORS, proxy ou extensão do navegador) ou o servidor está fora do ar.",
  badRequest: "A requisição não pôde ser processada.",
  unauthorized: "Sua sessão expirou ou você precisa entrar para continuar.",
  forbidden: "Você não tem permissão para esta ação.",
  notFound: "O recurso solicitado não foi encontrado.",
  conflict: "A ação conflita com o estado atual. Atualize e tente novamente.",
  tooLarge: "O conteúdo enviado é grande demais.",
  validation: "Alguns campos são inválidos. Revise e tente novamente.",
  rateLimited: "Muitas requisições em pouco tempo. Aguarde um pouco e tente novamente.",
  rateLimitedRetry: "Muitas requisições em pouco tempo. Tente novamente em {seconds}s.",
  unavailable: "O servidor está temporariamente indisponível. Tente novamente em instantes.",
  server: "O servidor encontrou um erro inesperado.",
  httpStatus: "Falha na requisição (HTTP {status}).",
  unexpected: "Ocorreu um erro inesperado."
} as const;
