      *****************************************************************
      * BATCH DE CONCILIACAO — exemplo da costura COBOL <-> DB2.
      *
      * Este programa compila, roda em volume pequeno e passa em teste.
      * Ele quebra em producao. Os quatro defeitos abaixo sao invisiveis
      * para quem olha so o COBOL ou so o SQL:
      *
      *   1. WS-VLR-TOTAL PIC S9(4) recebe uma coluna INTEGER
      *   2. cursor C-MOVTO aberto e nunca fechado
      *   3. SELECT dentro do PERFORM — uma ida ao DB2 por linha
      *   4. COMMIT no laco com cursor sem WITH HOLD -> SQLCODE -501
      *****************************************************************
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DB2BATCH.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-CONTA-ID             PIC 9(9).
       01  WS-VLR-TOTAL            PIC S9(4).
       01  WS-VLR-TAXA             PIC S9(9)V99.
       01  WS-LIDOS                PIC 9(7) VALUE ZERO.
       01  SQLCODE                 PIC S9(9) COMP.

       PROCEDURE DIVISION.

       MAIN-PARA.
           PERFORM ABRE-MOVIMENTO
           PERFORM PROCESSA-MOVIMENTO
           PERFORM ENCERRA
           STOP RUN.

       ABRE-MOVIMENTO.
      *    A coluna VLR_TOTAL e INTEGER: cabe ate 10 digitos.
           EXEC SQL
             DECLARE T-MOVTO TABLE
               (CONTA_ID INTEGER,
                VLR_TOTAL INTEGER,
                VLR_TAXA DECIMAL(11,2))
           END-EXEC.

           EXEC SQL
             DECLARE C-MOVTO CURSOR FOR
               SELECT CONTA_ID FROM T_MOVIMENTO
               WHERE DT_MOVTO = CURRENT DATE
           END-EXEC.

           EXEC SQL OPEN C-MOVTO END-EXEC.
           IF SQLCODE NOT = ZERO
             DISPLAY 'FALHA AO ABRIR CURSOR' SQLCODE
           END-IF.

       PROCESSA-MOVIMENTO.
           PERFORM UNTIL SQLCODE = 100
      *      FETCH em laco e o idioma CORRETO — nao deve ser apontado.
             EXEC SQL
               FETCH C-MOVTO INTO :WS-CONTA-ID
             END-EXEC

             IF SQLCODE = ZERO
      *        Uma ida ao DB2 por linha do cursor. No mainframe a CPU
      *        e faturada: isto tem preco na fatura, nao so latencia.
      *        E VLR_TOTAL (INTEGER, 10 digitos) nao cabe em S9(4).
               EXEC SQL
                 SELECT VLR_TOTAL, VLR_TAXA
                   INTO :WS-VLR-TOTAL, :WS-VLR-TAXA
                   FROM T_MOVIMENTO
                  WHERE CONTA_ID = :WS-CONTA-ID
               END-EXEC

               ADD 1 TO WS-LIDOS

      *        C-MOVTO nao foi declarado WITH HOLD: este COMMIT fecha o
      *        cursor e o FETCH seguinte devolve -501. So aparece quando
      *        o volume passa de 1000 — ou seja, em producao.
               IF WS-LIDOS > 1000
                 EXEC SQL COMMIT END-EXEC
                 MOVE ZERO TO WS-LIDOS
               END-IF
             END-IF
           END-PERFORM.

       ENCERRA.
      *    Falta o CLOSE de C-MOVTO: o bloqueio fica retido ate o fim da
      *    unidade de trabalho.
           DISPLAY 'PROCESSADOS: ' WS-LIDOS.
